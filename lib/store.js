// Upstash Redis over its REST API — no dependency, just fetch.
// If the env vars are absent (local dev), everything falls back to an
// in-memory map so the app still runs; the fallback resets on cold start,
// which is exactly why it is not good enough for production.

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export const usingRedis = Boolean(URL && TOKEN);

const memory = new Map(); // key -> { value, expires }

function memGet(key) {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expires && hit.expires < Date.now()) {
    memory.delete(key);
    return null;
  }
  return hit.value;
}

function memSet(key, value, ttlSeconds) {
  if (memory.size > 5000) memory.clear();
  memory.set(key, {
    value,
    expires: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0,
  });
}

// Upstash pipeline: [["INCR","k"],["EXPIRE","k","60"]] -> [{result},{result}]
async function pipeline(commands) {
  const res = await fetch(`${URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  return res.json();
}

/**
 * Fixed-window counters. Returns { ok, scope } — scope names which window
 * was blown so the caller can word the message.
 *
 * Redis failures fail OPEN: a Redis outage should degrade to "unlimited",
 * not to "site down". The spend cap on the API key is the real backstop.
 */
export async function rateLimit(ip, windows) {
  if (!usingRedis) {
    for (const w of windows) {
      const key = `rl:${w.name}:${ip}:${Math.floor(Date.now() / (w.seconds * 1000))}`;
      const next = (memGet(key) || 0) + 1;
      memSet(key, next, w.seconds);
      if (next > w.max) return { ok: false, scope: w.name };
    }
    return { ok: true };
  }

  try {
    const keys = windows.map(
      (w) => `rl:${w.name}:${ip}:${Math.floor(Date.now() / (w.seconds * 1000))}`
    );
    const cmds = [];
    for (let i = 0; i < windows.length; i++) {
      cmds.push(["INCR", keys[i]], ["EXPIRE", keys[i], String(windows[i].seconds)]);
    }
    const out = await pipeline(cmds);
    for (let i = 0; i < windows.length; i++) {
      const count = Number(out[i * 2]?.result ?? 0);
      if (count > windows[i].max) return { ok: false, scope: windows[i].name };
    }
    return { ok: true };
  } catch (err) {
    console.error("rate limit degraded:", err.message);
    return { ok: true, degraded: true };
  }
}

export async function cacheGet(key) {
  if (!usingRedis) return memGet(`c:${key}`);
  try {
    const [row] = await pipeline([["GET", `c:${key}`]]);
    return row?.result ? JSON.parse(row.result) : null;
  } catch (err) {
    console.error("cache read failed:", err.message);
    return null;
  }
}

export async function cacheSet(key, value, ttlSeconds) {
  if (!usingRedis) return memSet(`c:${key}`, value, ttlSeconds);
  try {
    await pipeline([
      ["SET", `c:${key}`, JSON.stringify(value), "EX", String(ttlSeconds)],
    ]);
  } catch (err) {
    console.error("cache write failed:", err.message);
  }
}
