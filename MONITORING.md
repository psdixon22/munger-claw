# How Munger Claw Actually Monitors Markets — The Honest Version

*Last audited: Apr 24 2026*

You asked: "How is Munger Claw actively gathering information on market intelligence and macro development themes? This is meant to constantly monitor so I can make real time decisions."

Here is the truth. No bull shit.

---

## What is actually running right now

**One thing: a scheduled task that fires 4 times a day (03:08, 09:08, 15:08, 21:08 local, with a few-minute jitter at dispatch).**

Between those runs — nothing is watching. No price poller. No news scraper. No X feed listener. The dashboard you see at `https://psdixon22.github.io/munger-claw/` is **a static snapshot from the last run**. If OKLO doubles at 11 AM, you will not see it until the 15:08 run rewrites the page at 3 PM-ish.

That's the gap. Calling this "real-time monitoring" would be a lie.

## What the scheduled task does on each run

Reads these sources — mostly through web search + web fetch inside the Claude session that the task spins up:

- **Yahoo Finance charts API** — last-trade prices for NVDA, PLTR, OKLO, RCAT, TSLA, TSM, ASML, AMD, CIFR, IREN, VST, CEG, and other tickers in the watchlist. Includes 20-day MA/high/low used to calibrate entry zones.
- **CoinGecko API** — HYPE, VVV, BTC, ETH spot + 24h change.
- **Web search** — latest Anthropic / OpenAI / Oklo / NVDA / Hyperliquid / Venice / congressional-trading news from the last ~24 hours, filtered to the priority theme list (AI ecosystem, defense, nuclear/energy, high-conviction crypto).
- **Web search for transcripts** — Gromen / Alden / Visser / Calacanis / Chamath / Friedberg / Sacks / Gerstner / Amodei / Jensen / Musk / Saylor / Hayes — pulls anything new in the last ~24 hours.
- **Congressional copy-trading** — surfaces top Capitol Trades / Quiver activity.
- Then the task **generates a new `index.html`** with fresh prices and action flags, writes the file to the repo, commits, pushes to GitHub Pages, and sends an `ntfy.sh` push so your phone buzzes.

That's the entire pipeline. It is a batch process, not a streaming monitor.

## What it does NOT do

- **No intra-run price polling.** Between 09:08 and 15:08, no one is watching NVDA.
- **No live zone-crossing alerts.** The alert bars at the top of the dashboard are cached text from the last run. If HYPE drops through $34 at 10 AM, you won't get pinged until 3 PM-ish — at which point the damage is done.
- **No X/Twitter streaming.** Claude can't connect to a streaming API from inside a scheduled task. It pulls recent tweets via web search, which is slow and incomplete.
- **No earnings-release listener.** PLTR earnings May 4 — the dashboard will learn about the result on the next scheduled run after it hits the wire.

## Why this matters to you

You explicitly said: **"It's important for me to get alerts for when positions hit entry zone, and that can't happen unless this is fixed."** Correct. The current setup cannot do that. The scheduled task can warn you "NVDA approaching $180 as of 3 PM" — but it cannot fire at the moment NVDA prints $180.01 at 10:37 AM.

## The fix — what real monitoring would require

You have one deployable piece already scaffolded: **`yahoo-proxy-worker.js`** in this repo. That's a Cloudflare Worker template. If you deploy it and add 30 lines, here's what becomes possible:

### Tier 1 — Price-crossing alerts (fixes your main ask)

A separate Cloudflare Worker on a 5-minute cron that:

1. Reads `actual_positions.json` from this repo.
2. Fetches current prices for each ticker.
3. Compares against a `zones.json` file (entry low, entry high, stop, T1).
4. If price crosses any of those levels vs. the last poll → `POST` to `ntfy.sh/mungerclaw-psd22` with ticker, price, zone crossed.
5. Stores last-seen prices in Cloudflare KV so it only pushes on *transitions*, not every 5 min.

Latency: ~5 minutes. Cost: free tier. Requires: ~1 hour to deploy.

### Tier 2 — Event-driven macro monitor

Another worker on a 15-minute cron that:

1. Hits GDELT / Google News RSS for each of the priority thinkers and themes.
2. Filters new items via keyword match.
3. Sends `ntfy` push with headline + link if match.

### Tier 3 — X/Twitter streaming

Requires paid API access ($100/mo). Not recommended at your capital level. The 4x-daily Claude runs + Tier 1 + Tier 2 above capture the actionable signal. Real-time Twitter noise would more often cause bad trades than good ones.

## What I recommend you do this week

1. **Deploy the existing `yahoo-proxy-worker.js`** (instructions in `STOCK_WORKER_SETUP.md`). That's currently needed to make the dashboard show live prices when you open it — without the Worker, the dashboard falls back to baked-in prices from the last scheduled run. Takes ~15 minutes.
2. **Ask me to build Tier 1** (price-crossing alert worker). I can scaffold it next session. You deploy with one `wrangler deploy` command.
3. **Leave Tier 2 / Tier 3 for later** — the 4x daily scheduled task already gives you decent theme coverage, and over-alerting is its own failure mode.

## Cadence of "truth" on this dashboard

- **Prices displayed** — fresh at scheduled-run time + refreshed each time you open the page IF the Worker URL is configured (Settings tab).
- **Entry zones / stops / targets** — recalibrated at each scheduled run from 20-day moving averages and recent lo/hi bands. Not recalibrated in-between.
- **Position holdings** — sourced from `actual_positions.json` on every page load (`bootstrapActualsFromJSON()`). This is the source of truth. Edit that file when you buy or sell.
- **News / thinker signals** — refreshed at each scheduled run only.

---

**This is not financial advice. Speculative trading involves substantial risk of loss. Past performance is no guarantee of future results.**
