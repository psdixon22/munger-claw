# Munger Claw — Real-Time Alert Stack · Deploy Guide

**Total time: ~35 minutes.** Zero coding required. Everything is paste-and-click.

You're deploying three Cloudflare Workers that close the real-time gap in the `MONITORING.md` audit:

1. **`01-prices.js`** — browser-callable price proxy (Yahoo + CoinGecko, with 20d tech). Powers live dashboard prices.
2. **`02-alerts.js`** — 5-minute cron. Detects when a position crosses a zone, stop, or target → push to your phone.
3. **`03-news.js`** — 15-minute cron. Polls Google News for priority thinkers + themes → push on new items.

All three push to the same `ntfy.sh` topic you already have: **`mungerclaw-psd22`**. They cost $0 on the Cloudflare free tier.

---

## Prerequisite: You need these two things

- A Cloudflare account (free) — sign up at https://dash.cloudflare.com/sign-up if you don't have one.
- The `ntfy` app installed on your phone, subscribed to topic `mungerclaw-psd22` (you should already have this).

That's it. Do **not** install Node, wrangler, or anything locally. Everything below uses Cloudflare's web dashboard.

---

## Step 1 — Deploy Worker 01 (Prices)

1. Go to https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Create Worker**.
2. Name it: **`munger-claw-prices`** → click **Deploy** (placeholder code is fine, you'll replace it).
3. Click **Edit code**. Select all the placeholder code (Ctrl/Cmd-A) and delete it.
4. Open `workers/01-prices.js` in this folder, copy the entire file, paste it into the Cloudflare editor.
5. Click **Save and deploy**.
6. Copy the worker URL from the top (looks like `https://munger-claw-prices.YOUR-SUBDOMAIN.workers.dev`). You'll need this twice.

**Test it:** open `https://munger-claw-prices.YOUR-SUBDOMAIN.workers.dev/?stocks=NVDA&crypto=hyperliquid` in your browser. You should see a JSON blob with real prices. If yes → move on.

**Wire it to the dashboard:**
1. Open https://psdixon22.github.io/munger-claw/ → **Settings** tab.
2. Paste the worker URL into **Cloudflare Worker URL** → **Save Settings**.
3. Refresh. Dashboard prices will now be live.

---

## Step 2 — Create a KV namespace (shared by alerts + news)

The alert and news workers both need a little storage to remember what they've already seen.

1. Cloudflare dashboard → **Workers & Pages** → **KV** → **Create a namespace**.
2. Name it: **`MUNGER_CLAW_STATE`** → **Add**.
3. Done. You'll bind it to the workers in the next steps.

---

## Step 3 — Deploy Worker 02 (Price-Crossing Alerts)

1. **Workers & Pages** → **Create** → **Create Worker**.
2. Name: **`munger-claw-alerts`** → **Deploy**.
3. **Edit code** → paste the entire contents of `workers/02-alerts.js` → **Save and deploy**.

**Bind the KV namespace:**
4. On the worker page → **Settings** → **Variables and Secrets** → scroll to **KV Namespace Bindings** → **Add binding**.
   - Variable name: **`ALERTS_KV`**
   - KV namespace: **`MUNGER_CLAW_STATE`**
   - **Save**.

**Set the secrets** (same page, top section **Variables and Secrets**):
5. Add each as a **Secret** (not plaintext):
   - Name: `NTFY_TOPIC`        · Value: `mungerclaw-psd22`
   - Name: `PRICES_URL`        · Value: `https://munger-claw-prices.YOUR-SUBDOMAIN.workers.dev`  *(from Step 1)*
   - Name: `REPO_RAW_BASE`     · Value: `https://raw.githubusercontent.com/psdixon22/munger-claw/main`

**Add the cron trigger:**
6. **Settings** → **Triggers** → **Cron Triggers** → **Add Cron Trigger**.
   - Expression: **`*/5 * * * *`** (every 5 minutes)
   - **Add trigger**.

**Test it:** open `https://munger-claw-alerts.YOUR-SUBDOMAIN.workers.dev/run` in your browser. You should see a JSON summary like `{"ran":"...","alerts":[],"state_size":7}`. The first run logs state but fires no alerts (nothing to compare against). Second run onward, any zone crossing will push to your phone.

---

## Step 4 — Deploy Worker 03 (News / Thinker Monitor)

Same pattern as Step 3.

1. **Create Worker** → name: **`munger-claw-news`** → **Deploy**.
2. **Edit code** → paste `workers/03-news.js` → **Save and deploy**.
3. **Settings** → **Variables and Secrets** → **KV Namespace Bindings** → **Add binding**:
   - Variable name: **`NEWS_KV`**
   - KV namespace: **`MUNGER_CLAW_STATE`**  *(same KV as Worker 02 — they share it)*
4. **Secrets**:
   - `NTFY_TOPIC` · `mungerclaw-psd22`
5. **Triggers** → **Cron Triggers** → Add **`*/15 * * * *`** (every 15 minutes).

**Test it:** open `https://munger-claw-news.YOUR-SUBDOMAIN.workers.dev/run`. First run will push ~10 current news items to your phone (it's populating the "already seen" cache). Subsequent runs only push new stuff.

---

## Step 5 — Test the full stack

Pick any position in `actual_positions.json` and temporarily edit `zones.json` to force a crossing:

1. Open `zones.json` in this folder.
2. Edit one entry (example): change `HYPE`'s `entry_low` from `38` to `42` (current price is ~$40.95, so `41` would be BELOW_ZONE, but setting low to 42 makes it IN_ZONE-to-BELOW_ZONE transition).
3. Commit + push:
   ```bash
   cd /path/to/dashboard
   git add zones.json
   git commit -m "test: trigger HYPE zone crossing"
   git push
   ```
4. Within 5 minutes the alert worker's cron will fire and you should get a push notification.
5. Revert the change (`git revert HEAD` + push) once you've confirmed it works.

---

## Ongoing maintenance — Who edits what

| Change | File | Who |
|---|---|---|
| Bought / sold shares | `actual_positions.json` | Claude (ask in chat) |
| Entry zone / stop / target recalibration | `zones.json` | Claude (ask in chat) |
| Add a ticker to watchlist alerts | `zones.json` (under `_watchlist`... or move into top level) | Claude |
| Change which thinkers/themes the news worker watches | `workers/03-news.js` (the `QUERIES` array) | Claude, then re-paste into the Cloudflare editor |
| Change cron frequency | Cloudflare dashboard → worker → Triggers | You, one click |

The scheduled dashboard task (4x daily Claude runs) continues to work in parallel. Between Claude runs, the workers carry the load for real-time alerts.

---

## Cost sanity check

- **Workers free tier:** 100,000 requests/day per account.
- Worker 01 (prices): browser calls, maybe 50/day = nothing.
- Worker 02 (alerts): 288 cron runs/day × ~8 tickers = ~2,300 internal calls. Fine.
- Worker 03 (news): 96 cron runs/day × 20 queries = ~1,900 calls. Fine.

Total daily burn: ~4,200 requests. You have ~23× headroom. You will not pay.

---

## Troubleshooting

- **No notifications firing:** check `https://munger-claw-alerts.YOUR-SUBDOMAIN.workers.dev/state` — if empty after 15 minutes, the cron isn't running. Re-check Step 3.6.
- **Alert worker returns `zones.json missing`:** make sure you committed `zones.json` to the repo (it's already in place as of this deploy).
- **News worker pushes duplicates:** first run dumps the current cache. After the first cycle, dedupe kicks in.
- **ntfy not delivering:** open the ntfy app → ensure you're subscribed to `mungerclaw-psd22` and notifications are enabled for the app at the OS level.

---

**This is not financial advice. Speculative trading involves substantial risk of loss. Past performance is no guarantee of future results.**
