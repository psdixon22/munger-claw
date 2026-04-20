// ============================================================
// MUNGER CLAW · Yahoo Finance Proxy Worker
// ============================================================
// Why this exists:
//   Yahoo's chart API does NOT send CORS headers, so a browser
//   cannot call it directly from the dashboard. This Worker sits
//   in front of Yahoo, fetches the data server-side, and returns
//   it with permissive CORS so the dashboard can pull live stock
//   prices on every refresh.
//
// Usage:
//   GET https://<your-worker>.workers.dev/?symbols=NVDA,PLTR,OKLO
//
// Response shape:
//   {
//     "fetchedAt": "2026-04-20T05:58:12.345Z",
//     "data": {
//       "NVDA": { "price": 201.68, "prevClose": 188.63,
//                 "currency": "USD", "marketState": "REGULAR",
//                 "timestamp": 1745176680 },
//       "PLTR": { ... },
//       ...
//     }
//   }
//
// Deploy:
//   1. cloudflare.com → Workers & Pages → Create → Worker
//   2. Name it: munger-claw-stocks
//   3. Click "Edit code", paste THIS WHOLE FILE, deploy.
//   4. Copy the workers.dev URL into the dashboard Settings.
// ============================================================

export default {
  async fetch(request) {
    // --- CORS preflight ---
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const symbolsParam = url.searchParams.get('symbols') || '';
    const symbols = symbolsParam
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);

    if (symbols.length === 0) {
      return jsonResponse(
        { error: 'no symbols provided',
          usage: '?symbols=NVDA,PLTR,OKLO' },
        400
      );
    }

    // Cap to prevent abuse
    if (symbols.length > 25) {
      return jsonResponse({ error: 'max 25 symbols per request' }, 400);
    }

    const results = {};
    await Promise.all(symbols.map(async (sym) => {
      try {
        const yUrl =
          `https://query1.finance.yahoo.com/v8/finance/chart/` +
          `${encodeURIComponent(sym)}?interval=1d&range=5d`;

        const yResp = await fetch(yUrl, {
          headers: {
            // Yahoo serves a cleaner response with a real UA
            'User-Agent':
              'Mozilla/5.0 (compatible; MungerClawProxy/1.0)',
            'Accept': 'application/json'
          },
          // Cloudflare edge cache for 30 seconds
          cf: { cacheTtl: 30, cacheEverything: true }
        });

        if (!yResp.ok) {
          results[sym] = { error: `yahoo http ${yResp.status}` };
          return;
        }

        const data = await yResp.json();
        const meta = data?.chart?.result?.[0]?.meta;

        if (!meta || meta.regularMarketPrice == null) {
          results[sym] = { error: 'no price data' };
          return;
        }

        results[sym] = {
          price: meta.regularMarketPrice,
          prevClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
          currency: meta.currency || 'USD',
          marketState: meta.marketState || 'UNKNOWN',
          timestamp: meta.regularMarketTime || null,
          exchange: meta.exchangeName || null
        };
      } catch (e) {
        results[sym] = { error: String(e && e.message || e) };
      }
    }));

    return jsonResponse({
      fetchedAt: new Date().toISOString(),
      data: results
    });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=20',
      ...corsHeaders()
    }
  });
}
