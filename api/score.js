// POST /api/score  ->  { scores, confidence, source }
//
// One Jev call, five ordered-rubric questions, evaluated in parallel.
// Jev returns a float index across each rubric's labels; we map that to 0-100.
//
// Docs: https://openrouter.ai/api/v1/systemone

const MODEL = process.env.JEV_MODEL || "typesafe/jev-1.13";
const ENDPOINT = "https://openrouter.ai/api/v1/systemone";

// Each rubric is ordered low -> high. Jev requires consistent progression.
const QUESTIONS = {
  novelty: {
    type: "score",
    instructions:
      "How unlike existing products on the market is this startup idea?",
    criteria: [
      "A direct clone of something that already exists",
      "A minor variation on an established product",
      "A familiar model applied to a new niche",
      "A genuinely uncommon approach",
      "Nothing like it exists today",
    ],
  },
  money: {
    type: "score",
    instructions: "How clear is this idea's path to real revenue?",
    criteria: [
      "No plausible way anyone pays for this",
      "Revenue is theoretical and unproven",
      "Someone would pay, but not much",
      "A clear customer with a clear budget",
      "Obvious, proven, high-margin revenue",
    ],
  },
  build: {
    type: "score",
    instructions:
      "How feasible is a working version for a small team within six months?",
    criteria: [
      "Requires unsolved science or enormous capital",
      "A year or more of hard engineering",
      "A few months of focused work",
      "A few weeks for a competent developer",
      "Buildable in a weekend",
    ],
  },
  viral: {
    type: "score",
    instructions:
      "How likely are users to tell other people about this unprompted?",
    criteria: [
      "Users would hide that they use it",
      "No reason to mention it to anyone",
      "Mild word of mouth among existing fans",
      "People would share it in group chats",
      "People would post it publicly and argue about it",
    ],
  },
  stupid: {
    type: "score",
    instructions:
      "How obviously flawed is the core premise of this idea, judged plainly?",
    criteria: [
      "Sound and sensible",
      "A normal amount of wrong",
      "Noticeably questionable",
      "Clearly a bad idea",
      "Self-evidently absurd",
    ],
  },
};

const KEYS = Object.keys(QUESTIONS);

// Jev's score is a float index over the rubric (0..n-1). Spread it to 0-100.
function toPercent(answer, labelCount) {
  const raw = Number(answer && answer.score);
  if (!Number.isFinite(raw)) return null;
  const span = Math.max(1, labelCount - 1);
  const pct = (Math.min(Math.max(raw, 0), span) / span) * 100;
  return Math.max(2, Math.min(99, Math.round(pct)));
}

// --- crude per-IP rate limit; resets when the function cold-starts ---
const HITS = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;

function rateLimited(ip) {
  const now = Date.now();
  const hits = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  HITS.set(ip, hits);
  if (HITS.size > 5000) HITS.clear(); // keep memory bounded
  return hits.length > MAX_PER_WINDOW;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (rateLimited(ip)) {
    return res
      .status(429)
      .json({ error: "Slow down — too many ideas in one minute." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const idea = String((body && body.idea) || "").trim().slice(0, 300);
  if (idea.length < 4) {
    return res.status(400).json({ error: "Write a few more words." });
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return res
      .status(500)
      .json({ error: "OPENROUTER_API_KEY is not set on the server." });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const upstream = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer":
          process.env.PUBLIC_URL || "https://is-this-startup-stupid.local",
        "X-Title": "Is This Startup Stupid",
      },
      body: JSON.stringify({
        model: MODEL,
        state: { startup_idea: idea },
        questions: QUESTIONS, // all five, one call, evaluated in parallel
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("jev upstream", upstream.status, detail.slice(0, 500));
      return res.status(502).json({
        error:
          upstream.status === 429
            ? "Jev is busy. Try again in a moment."
            : "Jev did not answer.",
      });
    }

    const data = await upstream.json();
    const answers = data.answers || {};

    const scores = {};
    const confidence = {};
    for (const k of KEYS) {
      const pct = toPercent(answers[k], QUESTIONS[k].criteria.length);
      if (pct === null) {
        console.error("missing answer for", k, JSON.stringify(answers[k]));
        return res.status(502).json({ error: "Jev returned an odd shape." });
      }
      scores[k] = pct;
      confidence[k] = Number(answers[k].confidence ?? 0);
    }

    return res.status(200).json({
      scores,
      confidence,
      source: "jev",
      model: data.model || MODEL,
      cost: data.usage?.cost ?? null,
    });
  } catch (err) {
    const aborted = err.name === "AbortError";
    console.error("jev call failed", err);
    return res
      .status(aborted ? 504 : 500)
      .json({ error: aborted ? "Jev timed out." : "Could not reach Jev." });
  } finally {
    clearTimeout(timer);
  }
}
