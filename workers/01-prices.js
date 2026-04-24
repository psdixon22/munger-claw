// ============================================================
// MUNGER CLAW · WORKER 01 · Prices + 20-day technicals
// ============================================================
// Purpose:
//   - Browser-side CORS proxy for Yahoo Finance + CoinGecko
//   - Returns last price, prev close, and 20-day MA/lo/hi
//   - Used by the dashboard AND by Worker 02 (price alerts)
//
// Endpoints:
//   GET /?stocks=NVDA,PLTR,OKLO&crypto=hyperliquid,venice-token
//   GET /health
//
// Deploy:
//   cd workers && wrangler deploy --name munger-claw-prices --compatibility-date 2024-01-01 01-prices.js
//   (or via Cloudflare dashboard: Workers > Create > paste this file)
//
// Cost: Free tier handles ~100k req/day. This worker uses edge cache (30s)
//       so it's nearly free even under aggressive polling.
// ============================================================

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() });
    }

    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json({ ok: true, service: 'munger-claw-prices', ts: Date.now() });
    }

    const stocks = (url.searchParams.get('stocks') || '')
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const crypto = (url.searchParams.get('crypto') || '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    if (stocks.length === 0 && crypto.length === 0) {
      return json({
        error: 'provide stocks=... or crypto=... symbols',
        example: '/?stocks=NVDA,PLTR&crypto=hyperliquid,venice-token'
      }, 400);
    }
    if (stocks.length > 30 || crypto.length > 20) {
      return json({ error: 'limit: 30 stocks, 20 crypto per request' }, 400);
    }

    const [stockData, cryptoData] = await Promise.all([
      stocks.length ? fetchStocks(stocks) : Promise.resolve({}),
      crypto.length ? fetchCrypto(crypto) : Promise.resolve({}),
    ]);

    return json({
      fetchedAt: new Date().toISOString(),
      stocks: stockData,
      crypto: cryptoData,
    });
  }
};

async function fetchStocks(symbols) {
  const results = {};
  await Promise.all(symbols.map(async sym => {
    try {
      const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=30d`;
      const r = await fetch(u, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        cf: { cacheTtl: 30, cacheEverything: true }
      });
      if (!r.ok) { results[sym] = { error: `yahoo ${r.status}` }; return; }
      const d = await r.json();
      const res = d?.chart?.result?.[0];
      const meta = res?.meta;
      if (!meta?.regularMarketPrice) { results[sym] = { error: 'no price' }; return; }

      // 20-day technicals
      const closes = (res.indicators?.quote?.[0]?.close || []).filter(x => x != null);
      const highs  = (res.indicators?.quote?.[0]?.high  || []).filter(x => x != null);
      const lows   = (res.indicators?.quote?.[0]?.low   || []).filter(x => x != null);
      const c20 = closes.slice(-20);
      const ma20 = c20.length ? c20.reduce((a,b)=>a+b,0) / c20.length : null;
      const lo20 = lows.length  ? Math.min(...lows.slice(-20))  : null;
      const hi20 = highs.length ? Math.max(...highs.slice(-20)) : null;

      results[sym] = {
        price:     meta.regularMarketPrice,
        prevClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
        ma20:      ma20 ? round2(ma20) : null,
        lo20:      lo20 ? round2(lo20) : null,
        hi20:      hi20 ? round2(hi20) : null,
        currency:  meta.currency || 'USD',
        marketState: meta.marketState || 'UNKNOWN',
        timestamp: meta.regularMarketTime || null,
      };
    } catch (e) {
      results[sym] = { error: String(e?.message || e) };
    }
  }));
  return results;
}

async function fetchCrypto(ids) {
  try {
    const u = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd&include_24hr_change=true`;
    const r = await fetch(u, {
      headers: { 'Accept': 'application/json' },
      cf: { cacheTtl: 30, cacheEverything: true }
    });
    if (!r.ok) { return { error: `coingecko ${r.status}` }; }
    const d = await r.json();
    const out = {};
    for (const id of ids) {
      if (d[id]) {
        out[id] = { price: d[id].usd, change24h: d[id].usd_24h_change ?? null };
      } else {
        out[id] = { error: 'not found on coingecko' };
      }
    }
    return out;
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

function round2(x) { return Math.round(x * 100) / 100; }

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=20',
      ...cors(),
    }
  });
}
