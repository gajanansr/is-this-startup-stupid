# Is This Startup Stupid?

A late-night infomercial that rates your startup idea. Five typed questions go to
**Jev** (TypeSafe's System One model) in a single call and come back as numbers with
calibrated confidence. Then the page does the math nobody asks for: how stupid the idea
is, versus how fundable it is anyway.

## Run it

```sh
cp .env.example .env     # then paste your OpenRouter key into .env
npm run dev              # http://localhost:3737 (walks up if that port is busy)
```

No dependencies. Node 20+.

## How the scoring works

`api/score.js` sends one request to `POST https://openrouter.ai/api/v1/systemone` with
five `score` questions. Each is a five-level ordered rubric (low → high), which is the
shape Jev wants — it returns a float index across the labels plus a confidence value:

```json
{ "type": "score", "score": 3.12, "confidence": 0.94,
  "legend": { "0": "Calm", "1": "Frustrated", "2": "Very angry" } }
```

The handler maps that index onto 0–100 and hands the page five percentages.

**Fundability is not a model output.** It's computed client-side in `fundability()`:

```js
0.45*novelty + 0.30*viral + 0.15*money + 0.10*(100 - build)
```

Buildability is inverted on purpose — hard-to-build scores *higher*. That inversion is
what produces the "78% stupid / 91% fundable" gap the whole joke rests on. Keep it in
our code, not the model's.

The roast lines are a hand-written bank in `public/index.html`, picked by which metric
scored loudest. Jev returns numbers and cannot write prose — the comedy is ours.

## Deploy

Vercel picks this up as-is: `public/` is served statically and `api/score.js` becomes a
serverless function.

```sh
vercel
vercel env add OPENROUTER_API_KEY
```

For Netlify or Cloudflare Pages, move `api/score.js` into that platform's functions
directory; the handler body is standard `fetch` and needs no changes beyond the
request/response wrapper.

## Cost and abuse

Jev is $0.042 per 1M input tokens with free output. One evaluation is a few hundred
tokens — a fraction of a cent per thousand plays. The real risk is someone hammering the
endpoint, so `api/score.js` rate-limits to **12 requests per IP per minute**, in memory.
That resets on every cold start, so if this ever gets real traffic, move the limiter to
Redis or Vercel KV and set a spend cap on the OpenRouter key.

Ideas are truncated to 300 characters before they reach the API.

## Files

| Path | What it is |
|---|---|
| `public/index.html` | The whole front end — CRT chassis, layout, roast bank, fetch |
| `api/score.js` | The Jev call, rubrics, 0–100 mapping, rate limit |
| `dev.js` | Dependency-free local server that mimics the Vercel routing |
