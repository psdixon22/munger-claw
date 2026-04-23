# How to log a trade (the simple way)

Your actual positions live in **`actual_positions.json`** in this repo. The dashboard loads it on every page load and uses it to override the model portfolio wherever the tickers match. No more fiddly manual typing into forms and losing it when the browser cache clears.

## The 10-second workflow

Open a chat with Claude (Cowork mode or Claude Code) in the `Investment Agent` folder and say one of these:

- `"Bought 20 NVDA at 201.30 today"`
- `"Sold half my HYPE at 58.20"`
- `"Added 5 OKLO at 72"`
- `"Exited RCAT at 13.50"`
- `"Set base capital to 15000"`

Claude will:
1. Read `actual_positions.json`
2. Apply the change (weighted-average new shares into your avg_cost, or reduce/close)
3. Append an entry to the `history` array with date + action + note
4. Commit with a clear message and push to GitHub
5. Confirm the new state back to you

Within ~30 seconds `https://psdixon22.github.io/munger-claw/` refreshes and shows the new position.

## What the dashboard does with it

- **Ticker you own AND model covers** → dashboard shows your actual shares, cost, live P&L. Model's recommended allocation is still visible as a target for rebalance comparisons. The "Action" flag tells you BUY / ADD / HOLD / TRIM / EXIT.
- **Ticker you own but model no longer covers** → flagged "EXIT" (model dropped it, consider closing).
- **Ticker the model calls for but you don't own** → flagged "NEW · BUY" so you know it's a fresh idea.
- **Big deviation from model (default > 15%)** → rebalance suggestion surfaces automatically.

In short: actual positions supplant model positions when they overlap. The model portfolio's job is to flag gaps and shifts.

## Editing by hand (if you ever need to)

The file is plain JSON. Schema:

```json
{
  "as_of": "YYYY-MM-DD",
  "base_capital": 10000,
  "positions": [
    { "ticker": "NVDA", "type": "stock",  "shares": 11.0, "avg_cost": 200.00, "entry_date": "2026-04-18", "notes": "Inception." }
  ],
  "cash": 0,
  "history": [
    { "date": "YYYY-MM-DD", "action": "buy|sell|add|trim|exit|seed_from_model", "note": "free-text" }
  ]
}
```

Rules:
- `avg_cost` is cost basis per share (weighted average across all your buys of that ticker).
- When you add to a position, weighted-average: `new_avg = (old_shares * old_avg + added_shares * added_price) / (old_shares + added_shares)`.
- When you sell a partial, keep `avg_cost` the same; just reduce `shares`. (Cost basis for the remainder doesn't change — the realized portion gets a history entry.)
- Drop a position entirely by removing its object from the `positions` array.

## Why this lives on GitHub

- Source of truth in one place — not in a browser cache that dies when you clear cookies.
- Survives computer swaps and cache wipes.
- Dashboard works on phone, laptop, iPad, anywhere.
- Full audit trail via `git log actual_positions.json`.

## When things look wrong

If the dashboard still shows stale numbers after a commit: force-refresh the browser (Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac). GitHub Pages caches for ~30s; sometimes CDNs hold longer.
