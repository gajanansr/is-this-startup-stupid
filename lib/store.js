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

const bucketKey = (name, ip, seconds) =>
  `rl:${name}:${ip}:${Math.floor(Date.now() / (seconds * 1000))}`;

/**
 * Read the current counters WITHOUT incrementing. Use this to decide whether
 * a request is allowed; a rejected request must not consume anyone's quota,
 * or retrying after a "come back later" silently burns the daily allowance.
 *
 * Redis failures fail OPEN: an outage should degrade to "unlimited", not to
 * "site down". The spend cap on the API key is the real backstop.
 */
export async function checkLimit(ip, windows) {
  if (!usingRedis) {
    for (const w of windows) {
      if ((memGet(bucketKey(w.name, ip, w.seconds)) || 0) >= w.max) {
        return { ok: false, scope: w.name };
      }
    }
    return { ok: true };
  }
  try {
    const out = await pipeline(
      windows.map((w) => ["GET", bucketKey(w.name, ip, w.seconds)])
    );
    for (let i = 0; i < windows.length; i++) {
      if (Number(out[i]?.result ?? 0) >= windows[i].max) {
        return { ok: false, scope: windows[i].name };
      }
    }
    return { ok: true };
  } catch (err) {
    console.error("limit check degraded:", err.message);
    return { ok: true, degraded: true };
  }
}

/** Increment the counters. Call this only once the request is committed. */
export async function consumeLimit(ip, windows) {
  if (!usingRedis) {
    for (const w of windows) {
      const key = bucketKey(w.name, ip, w.seconds);
      memSet(key, (memGet(key) || 0) + 1, w.seconds);
    }
    return;
  }
  try {
    const cmds = [];
    for (const w of windows) {
      const key = bucketKey(w.name, ip, w.seconds);
      cmds.push(["INCR", key], ["EXPIRE", key, String(w.seconds)]);
    }
    await pipeline(cmds);
  } catch (err) {
    console.error("limit consume failed:", err.message);
  }
}

/**
 * Flood guard: increment and check in one round trip. Here every request
 * counts, retries included — that is the point of a flood guard.
 */
export async function rateLimit(ip, windows) {
  if (!usingRedis) {
    for (const w of windows) {
      const key = bucketKey(w.name, ip, w.seconds);
      const next = (memGet(key) || 0) + 1;
      memSet(key, next, w.seconds);
      if (next > w.max) return { ok: false, scope: w.name };
    }
    return { ok: true };
  }
  try {
    const cmds = [];
    for (const w of windows) {
      const key = bucketKey(w.name, ip, w.seconds);
      cmds.push(["INCR", key], ["EXPIRE", key, String(w.seconds)]);
    }
    const out = await pipeline(cmds);
    for (let i = 0; i < windows.length; i++) {
      if (Number(out[i * 2]?.result ?? 0) > windows[i].max) {
        return { ok: false, scope: windows[i].name };
      }
    }
    return { ok: true };
  } catch (err) {
    console.error("flood guard degraded:", err.message);
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
