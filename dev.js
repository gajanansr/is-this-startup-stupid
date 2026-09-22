// Local dev server. No dependencies — `node dev.js` and open http://localhost:3000
// Serves public/ and routes POST /api/score to the same handler Vercel runs.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import handler from "./api/score.js";

const ROOT = resolve(import.meta.dirname, "public");
const PORT = Number(process.env.PORT || 3737);

// minimal .env loader (KEY=value, # comments, optional quotes)
const envPath = resolve(import.meta.dirname, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function shim(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/score") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    try {
      req.body = raw ? JSON.parse(raw) : {};
    } catch {
      return shim(res).status(400).json({ error: "Bad JSON." });
    }
    try {
      return await handler(req, shim(res));
    } catch (err) {
      console.error(err);
      return shim(res).status(500).json({ error: "Handler threw." });
    }
  }

  const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.statusCode = 403;
    return res.end("Forbidden");
  }
  try {
    const buf = await readFile(file);
    res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
    res.end(buf);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});

// If the port is taken, walk up instead of crashing.
let port = PORT;
server.on("error", (err) => {
  if (err.code === "EADDRINUSE" && port < PORT + 20) {
    console.log(`  port ${port} busy, trying ${port + 1}…`);
    server.listen(++port);
  } else {
    throw err;
  }
});
server.on("listening", () => {
  console.log(`\n  Is This Startup Stupid  →  http://localhost:${port}`);
  console.log(
    process.env.OPENROUTER_API_KEY
      ? "  OPENROUTER_API_KEY loaded.\n"
      : "  ⚠  OPENROUTER_API_KEY missing — add it to .env\n"
  );
});
server.listen(port);
