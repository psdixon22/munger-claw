# Stock Worker Setup — 5 Minutes, Zero Code

You're going to deploy a tiny Cloudflare Worker that pulls live stock prices from Yahoo and hands them to your dashboard. **You won't write or read any code** — you'll copy a file, paste it, and click Deploy.

---

## What this fixes

Right now your dashboard shows live crypto (good) but **stocks are frozen at whatever the price was when I last ran the scheduled task** (e.g., 19:58 ET on Apr 19). After you finish this setup, stocks will refresh every 60 seconds in your browser, just like crypto does.

---

## Step 1 — Open Cloudflare

1. Go to **https://dash.cloudflare.com/**
2. Sign in (you already have an account because you set up the chat worker before).
3. Left sidebar → click **Workers & Pages**.

## Step 2 — Create a new Worker

1. Click the **Create** button (top right).
2. Click **Create Worker**.
3. **Name it:** `munger-claw-stocks`
4. Click **Deploy** (it will deploy a default "Hello World" — that's fine, we'll replace it next).

## Step 3 — Paste the code

1. After it deploys, click **Edit code** (top right).
2. **Delete everything** in the editor.
3. Open the file `yahoo-proxy-worker.js` from your Investment Agent folder.
4. Copy the entire contents.
5. Paste into the Cloudflare editor.
6. Click **Deploy** (top right).
7. Click **Save and deploy** to confirm.

## Step 4 — Copy your Worker URL

After deploy, you'll see a URL like:
```
https://munger-claw-stocks.<your-subdomain>.workers.dev
```

Copy the whole URL.

## Step 5 — Test it (optional but smart)

Paste this into a new browser tab, replacing `<URL>` with what you copied:
```
<URL>?symbols=NVDA,PLTR,OKLO
```

You should see something like:
```json
{
  "fetchedAt": "2026-04-20T...",
  "data": {
    "NVDA": { "price": 201.68, "prevClose": 188.63, ... },
    ...
  }
}
```

If you see prices, **it works.** If you see an error, paste the error to me and I'll debug.

## Step 6 — Plug it into the dashboard

1. Open your Munger Claw dashboard: **https://psdixon22.github.io/munger-claw/**
2. Click the **⚙️ Settings** tab.
3. Find the **"Stock Worker URL"** field (I just added it).
4. Paste your Worker URL.
5. Click **Save Settings**.
6. Click the **Dashboard** tab — within 5 seconds the freshness banner should flip from "🟡 Stocks · server-baked" to **"🟢 Stocks · live"** with a fresh timestamp.

That's it. Stocks now refresh every 60 seconds.

---

## Troubleshooting

**"Worker not configured" still shows after Save?**
Hard-refresh the dashboard: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac).

**Worker returns errors for some symbols?**
Yahoo occasionally throttles. The dashboard will fall back to the last good price, so this is non-fatal. If it persists for hours, paste the error to me.

**Worried about cost?**
Cloudflare's free tier gives you 100,000 Worker requests per day. The dashboard polls 7 stocks every 60s = 10,080 requests/day even if you leave it open all 24 hours. **You'll never come close to the free limit.**

**Worried about security?**
The Worker only proxies public Yahoo data. No keys, no secrets, no auth. If someone finds your Worker URL, the worst they can do is look up stock prices, which they can do for free directly on Yahoo.

---

*Not financial advice. Speculative trading involves substantial risk of loss. Past performance is no guarantee of future results.*
