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

One evaluation costs about **$0.000029** — roughly 170,000 plays per $5 of credit. Abuse
here is annoying rather than expensive, which is why there is no login and no email gate:
both would cost more in lost reach than the money they would protect.

Four layers instead, cheapest first:

1. **A spend cap on the OpenRouter key.** The real backstop. Worst case becomes "the site
   stops working", never "you get a bill". Set it in the OpenRouter dashboard.
2. **Rate limiting**, in two tiers, because clicks and money are different things.
   A *traffic* guard (30/min per IP) applies to everything and stops floods. A *spend*
   guard (**5/min, 20/day**) applies only after a cache miss, when the request is about
   to actually cost something — replaying a cached idea is free, so it shouldn't burn
   anyone's quota.
   Both are backed by Upstash Redis when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
   are set, and by an in-memory map otherwise. The spend guard checks the counters
   *without* incrementing and only consumes quota once the request is committed to
   calling Jev — otherwise retrying after a rejection would silently eat the daily 20. **Set them before deploying**: serverless
   cold starts wipe the in-memory version, which makes it close to useless in production.
   Redis failures deliberately fail *open* — an outage should degrade to "unlimited",
   not to "site down", because the spend cap is already catching the money.
3. **Caching by idea text** (30 days). The same idea always deserves the same score, and
   everybody types "Uber for dogs". Keys are a hash of the lowercased,
   whitespace-collapsed idea, so casing and spacing variants share one entry.
4. **Vercel Attack Challenge Mode** — a free toggle in the Vercel dashboard that stops
   naive bot floods without adding friction for real visitors.

On phones the verdict sits below the input, so the page scrolls it into view after a
score — a tap that appears to do nothing reads as a broken app. Smooth scrolling silently
no-ops in some embedded contexts, so there is a fallback that lands the jump regardless.

The page also opens on a baked-in sample verdict rather than scoring something on load.
A pageview costs nothing; a visitor's first click is their first API call.

Ideas are truncated to 300 characters before they reach the API.

## Files

| Path | What it is |
|---|---|
| `public/index.html` | The whole front end — CRT chassis, layout, roast bank, fetch |
| `api/score.js` | The Jev call, rubrics, 0–100 mapping, rate limit |
| `lib/store.js` | Upstash-backed rate limiting and cache, with in-memory fallback |
| `dev.js` | Dependency-free local server that mimics the Vercel routing |
| `media/promo.mp4` | 7s silent demo loop for social posts |
| `scripts/make-icons.mjs` | Renders the 16x16 pixel art to PNG icons (`node scripts/make-icons.mjs`) |

## Analytics

Vercel Web Analytics is wired in as two script tags at the bottom of
`public/index.html`. The `@vercel/analytics` npm package is deliberately **not**
installed — it needs a bundler, and this project has no build step and no
dependencies. Vercel serves `/_vercel/insights/script.js` itself once Analytics is
enabled for the project in the dashboard; until then the request 404s harmlessly and
the page is unaffected.

## Credits

Built by [@gajananrx](https://x.com/gajananrx) · [github.com/gajanansr](https://github.com/gajanansr)
Scored by [Jev](https://openrouter.ai/typesafe/jev-1.13), TypeSafe's System One model.
