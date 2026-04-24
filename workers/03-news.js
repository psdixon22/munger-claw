// ============================================================
// MUNGER CLAW · WORKER 03 · Macro / Thinker News Monitor (Tier 2)
// ============================================================
// Purpose:
//   - Runs on a 15-minute cron
//   - Polls Google News RSS for each priority query (thinkers + themes)
//   - Dedupes by Google News cluster ID (stored in KV)
//   - Pushes only NEW items to ntfy
//   - Rate-limits to max 10 pushes per cycle to avoid spam
//
// Deploy:
//   wrangler deploy --name munger-claw-news 03-news.js
//   Bind KV namespace: NEWS_KV
//   Cron trigger: */15 * * * *
//
// Env vars required:
//   NTFY_TOPIC      — same topic as alerts worker (mungerclaw-psd22)
// ============================================================

const QUERIES = [
  // Priority thinkers
  { q: 'Arthur Hayes Maelstrom', tag: 'hayes' },
  { q: 'Luke Gromen FFTT dollar', tag: 'gromen' },
  { q: 'Lyn Alden macro', tag: 'alden' },
  { q: 'Chamath Palihapitiya', tag: 'chamath' },
  { q: 'Dario Amodei Anthropic', tag: 'amodei' },
  { q: 'Jensen Huang Nvidia keynote', tag: 'jensen' },
  { q: 'David Sacks AI czar', tag: 'sacks' },
  { q: 'Brad Gerstner Altimeter', tag: 'gerstner' },
  { q: 'Michael Saylor Bitcoin strategy', tag: 'saylor' },

  // Portfolio-specific catalysts
  { q: 'Oklo nuclear SMR OKLO stock', tag: 'oklo' },
  { q: 'Hyperliquid HYPE ETF', tag: 'hype' },
  { q: 'Venice AI VVV Morpheus', tag: 'vvv' },
  { q: 'Palantir earnings PLTR', tag: 'pltr' },
  { q: 'Nvidia NVDA earnings data center', tag: 'nvda' },
  { q: 'Tesla TSLA robotaxi Optimus', tag: 'tsla' },
  { q: 'Red Cat Anduril drone defense', tag: 'rcat' },

  // Macro themes
  { q: 'congressional trading disclosure Pelosi', tag: 'congress' },
  { q: 'AI datacenter power nuclear grid', tag: 'ai-power' },
  { q: 'Federal Reserve rate cut FOMC', tag: 'fomc' },
  { q: 'Treasury auction yield dollar', tag: 'tsy' },
];

const MAX_PUSHES_PER_CYCLE = 10;
const ITEM_TTL_DAYS = 7; // keep dedupe entries for 7 days

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runNewsCycle(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      const r = await runNewsCycle(env);
      return new Response(JSON.stringify(r, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('munger-claw-news · endpoints: /run', {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

async function runNewsCycle(env) {
  const summary = { ran: new Date().toISOString(), pushed: [], errors: [], skipped_dupes: 0 };
  let pushCount = 0;

  for (const { q, tag } of QUERIES) {
    if (pushCount >= MAX_PUSHES_PER_CYCLE) break;
    try {
      const items = await fetchGoogleNews(q);
      for (const item of items.slice(0, 3)) { // top 3 per query
        if (pushCount >= MAX_PUSHES_PER_CYCLE) break;
        const key = `seen:${hashItemId(item.link)}`;
        const seen = await env.NEWS_KV.get(key);
        if (seen) { summary.skipped_dupes++; continue; }

        // Mark seen BEFORE pushing so a retry doesn't double-send
        await env.NEWS_KV.put(key, '1', { expirationTtl: 86400 * ITEM_TTL_DAYS });

        // Skip items older than 3 hours — RSS can include stale clusters
        const pubTime = new Date(item.pubDate).getTime();
        if (Date.now() - pubTime > 3 * 3600 * 1000) continue;

        await pushNtfy(env.NTFY_TOPIC, { ...item, tag });
        summary.pushed.push({ tag, title: item.title });
        pushCount++;
      }
    } catch (e) {
      summary.errors.push(`${q}: ${String(e?.message || e)}`);
    }
  }
  summary.pushed_count = pushCount;
  return summary;
}

async function fetchGoogleNews(query) {
  const u = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const r = await fetch(u, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MungerClawNewsBot/1.0)' },
    cf: { cacheTtl: 300, cacheEverything: true }
  });
  if (!r.ok) throw new Error(`rss ${r.status}`);
  const xml = await r.text();
  return parseRSS(xml);
}

// Minimal RSS parser — Google News RSS is well-formed XML
function parseRSS(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < 5) {
    const block = m[1];
    const title   = extract(block, 'title');
    const link    = extract(block, 'link');
    const pubDate = extract(block, 'pubDate');
    const source  = extract(block, 'source');
    if (title && link) items.push({ title, link, pubDate, source });
  }
  return items;
}
function extract(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`);
  const m = xml.match(re);
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

function hashItemId(url) {
  // djb2 hash — small and stable, no crypto needed
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function pushNtfy(topic, item) {
  await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    body: `${item.source ? `[${item.source}] ` : ''}${item.title}`,
    headers: {
      'Title': `📰 ${item.tag.toUpperCase()} news`,
      'Priority': '3',
      'Tags': `newspaper,${item.tag}`,
      'Click': item.link,
    }
  });
}
