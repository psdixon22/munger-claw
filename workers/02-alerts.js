// ============================================================
// MUNGER CLAW · WORKER 02 · Price-Crossing Alerts (Tier 1)
// ============================================================
// Purpose:
//   - Runs on a 5-minute cron trigger
//   - Reads actual_positions.json + zones.json from your GitHub Pages site
//   - Calls Worker 01 (prices) for fresh data
//   - Compares each position's price against the zone thresholds
//   - ONLY sends a push to ntfy when a threshold is CROSSED
//     (i.e., state transitioned since last poll) — avoids spam
//   - Stores the last state in Cloudflare KV
//
// Alerts fired:
//   ENTER_ZONE     — price entered the buy zone (entry_low ≤ p ≤ entry_high)
//   EXIT_ZONE_UP   — price rose above entry_high (missed the buy)
//   EXIT_ZONE_DOWN — price fell below entry_low (approaching stop)
//   STOP_HIT       — price hit or broke the stop → urgent
//   T1_HIT         — first price target reached → consider trimming
//   T2_HIT         — second price target reached → take profits
//   EXTENDED       — price >15% above 20d MA → do not add
//
// Deploy:
//   wrangler deploy --name munger-claw-alerts 02-alerts.js
//   Also bind a KV namespace called ALERTS_KV (see DEPLOY.md)
//   And set a cron trigger: */5 * * * *
//
// Env vars required (set via wrangler secret put):
//   NTFY_TOPIC       — ntfy topic name (e.g. mungerclaw-psd22)
//   PRICES_URL       — URL to Worker 01 (https://...workers.dev)
//   REPO_RAW_BASE    — https://raw.githubusercontent.com/psdixon22/munger-claw/main
// ============================================================

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAlertCycle(env));
  },
  async fetch(request, env) {
    // Manual trigger: GET /run — useful for testing
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      const result = await runAlertCycle(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname === '/state') {
      const state = await env.ALERTS_KV.get('last_state');
      return new Response(state || '{}', {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('munger-claw-alerts · endpoints: /run /state', {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

async function runAlertCycle(env) {
  const summary = { ran: new Date().toISOString(), alerts: [], errors: [] };

  try {
    // 1. Load positions + zones from the public repo
    const [positions, zones] = await Promise.all([
      fetchJSON(`${env.REPO_RAW_BASE}/actual_positions.json`),
      fetchJSON(`${env.REPO_RAW_BASE}/zones.json`).catch(() => null),
    ]);
    if (!positions?.positions?.length) {
      summary.errors.push('no positions loaded');
      return summary;
    }
    if (!zones) {
      summary.errors.push('zones.json missing — cannot evaluate alerts');
      return summary;
    }

    // 2. Split into stock + crypto tickers
    const stockSyms = [];
    const cryptoIds = [];
    for (const p of positions.positions) {
      const z = zones[p.ticker];
      if (!z) continue;
      if (p.type === 'crypto' && z.coingecko_id) cryptoIds.push(z.coingecko_id);
      else stockSyms.push(p.ticker);
    }

    // 3. Fetch live prices via Worker 01
    const url = `${env.PRICES_URL}/?stocks=${stockSyms.join(',')}&crypto=${cryptoIds.join(',')}`;
    const live = await fetchJSON(url);
    const now = {};
    for (const s of stockSyms) if (live.stocks?.[s]?.price) now[s] = live.stocks[s];
    for (const p of positions.positions) {
      if (p.type === 'crypto') {
        const cg = zones[p.ticker]?.coingecko_id;
        if (cg && live.crypto?.[cg]?.price) now[p.ticker] = { price: live.crypto[cg].price, change24h: live.crypto[cg].change24h };
      }
    }

    // 4. Load prior state
    const lastStateStr = await env.ALERTS_KV.get('last_state');
    const lastState = lastStateStr ? JSON.parse(lastStateStr) : {};
    const newState = {};

    // 5. Evaluate each position
    const firedAlerts = [];
    for (const p of positions.positions) {
      const z = zones[p.ticker];
      const price = now[p.ticker]?.price;
      if (!z || !price) continue;

      const zone = classifyZone(price, z);
      newState[p.ticker] = { price, zone, ts: Date.now() };
      const prevZone = lastState[p.ticker]?.zone;
      if (prevZone && prevZone !== zone) {
        firedAlerts.push({
          ticker: p.ticker, price, from: prevZone, to: zone,
          cost: p.avg_cost, shares: p.shares, ...z
        });
      }
    }

    // 6. Persist new state
    await env.ALERTS_KV.put('last_state', JSON.stringify(newState));
    summary.state_size = Object.keys(newState).length;

    // 7. Push ntfy notifications (one per transition)
    for (const a of firedAlerts) {
      await pushNtfy(env.NTFY_TOPIC, a);
      summary.alerts.push({ ticker: a.ticker, transition: `${a.from}→${a.to}`, price: a.price });
    }
  } catch (e) {
    summary.errors.push(String(e?.message || e));
  }
  return summary;
}

function classifyZone(p, z) {
  if (z.stop && p <= z.stop) return 'STOP_HIT';
  if (z.t2 && p >= z.t2) return 'T2_HIT';
  if (z.t1 && p >= z.t1) return 'T1_HIT';
  if (z.ma20 && z.extended_mult && p >= z.ma20 * z.extended_mult) return 'EXTENDED';
  if (z.entry_low && z.entry_high && p >= z.entry_low && p <= z.entry_high) return 'IN_ZONE';
  if (z.entry_high && p > z.entry_high) return 'ABOVE_ZONE';
  if (z.entry_low && p < z.entry_low) return 'BELOW_ZONE';
  return 'UNKNOWN';
}

async function pushNtfy(topic, alert) {
  const emoji = {
    STOP_HIT:     '🚨',
    T2_HIT:       '🎯',
    T1_HIT:       '✅',
    EXTENDED:     '⚠️',
    IN_ZONE:      '🟢',
    ABOVE_ZONE:   '⬆️',
    BELOW_ZONE:   '⬇️',
  }[alert.to] || '📊';
  const priority = (alert.to === 'STOP_HIT') ? '5' :
                   (alert.to === 'IN_ZONE' || alert.to === 'T1_HIT' || alert.to === 'T2_HIT') ? '4' : '3';
  const title = `${emoji} ${alert.ticker} ${alert.to.replace('_',' ')}`;
  const body = [
    `${alert.ticker} $${alert.price} — was ${alert.from}, now ${alert.to}`,
    alert.entry_low ? `Zone: $${alert.entry_low}–$${alert.entry_high} · Stop $${alert.stop ?? '?'}` : '',
    `Position: ${alert.shares} @ $${alert.cost} (cost basis $${(alert.shares*alert.cost).toFixed(0)})`,
  ].filter(Boolean).join('\n');

  await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    body,
    headers: {
      'Title': title,
      'Priority': priority,
      'Tags': alert.ticker.toLowerCase(),
      'Click': 'https://psdixon22.github.io/munger-claw/',
    }
  });
}

async function fetchJSON(url) {
  const r = await fetch(url, { cf: { cacheTtl: 15 } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return await r.json();
}
