# Backtesting lab

A static dashboard for ICT backtests and paper trades logged in Notion. It reads Notion CSV exports and shows which model works under which conditions. No server, no database, no build step.

Live at `https://<your-username>.github.io/trading/backtesting/` once GitHub Pages is on.

## First-time setup

1. Copy this `backtesting/` folder into the root of your `trading` repository and push.
2. On GitHub, open the repo → **Settings** → **Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*, **Branch** to `main` and folder `/ (root)`. Save.
4. After about a minute the dashboard is live at the URL above. Until you add your own data it shows the sample data in `data/sample/`.

## Updating the data

1. In Notion, open the **Trades** database, click **⋯** → **Export** → format **Markdown & CSV**, include **Current view**. Do the same for **Accounts**.
2. Unzip the downloads. Notion adds an ID to file names, so rename them to `trades.csv` and `accounts.csv`.
3. Put both in `backtesting/data/` (not in `data/sample/`) and push.

The dashboard always prefers `data/trades.csv` and only falls back to the sample when it is missing.

For a quick look without committing, open the dashboard and use **Load CSV**. The file stays in that browser tab and is not uploaded anywhere.

> Export a view that shows every property. Hidden properties are left out of Notion's CSV, and the dashboard will report them as missing columns on the **Data health** page.

## If you rename a Notion property

Edit `schema.json`: the left side is the dashboard's field, the right side is your Notion column name. If your Notion dates are numeric (`26/10/2026`), set `dateOrder` to `DMY`.

## What each page answers

| Page | Question |
| --- | --- |
| Overview | Am I profitable, how sure is that, and how deep were the drawdowns? |
| Conditions | Which combination of conditions (session × day, liquidity × direction…) has the edge? Includes today's-conditions checker and each model's playbook. |
| Timing | At what time, day, kill zone and macro do my entries work? |
| Setups & sessions | After which liquidity sweep should I trade which session and direction? Which confluences add expectancy? |
| Execution & mindset | Do I follow the plan, grade setups well, trade worse after losses or when emotional? Does paper trading match the backtest? |
| Prop simulator | Would this model pass the challenge in the Accounts database, and what risk per trade fits its drawdown? |
| Trade log | Every filtered trade, searchable, with a CSV download. |
| Data health | Rows that were excluded or look wrong, and why. |

Filters and the R / $ / % switch apply to every page, and the current view is saved in the URL so you can bookmark it.

## How the numbers are calculated

- **Expectancy** is the average R per trade. The 95% range comes from 1,000 bootstrap resamples.
- **Win rate** counts breakevens as non-wins.
- **$** = R × the trade's `Risk ($)` (or the account's risk if empty). **%** = $ ÷ the account's size.
- **Bad-case drawdown** is the 95th percentile of the max drawdown over 1,000 reshuffles of the trade order.
- **Suggested risk** = account max drawdown ÷ (bad-case drawdown × 2), shown only from 100 trades.
- **Pass rate** draws trades at random from the model's results until the account hits the target or the max drawdown, 2,000 times. It assumes a static drawdown; a trailing drawdown passes less often.
- Cells, rows and slices with few trades are faded or hatched. Treat anything under 30 trades as noise.

## Files

```
backtesting/
  index.html          page shell
  schema.json         Notion column names → dashboard fields
  assets/data.js      CSV parsing and validation
  assets/stats.js     all metrics and simulations
  assets/app.js       filters, pages and charts
  assets/styles.css   styles, light and dark
  data/               your exports go here
  data/sample/        synthetic data for testing
  tools/              sample-data generator and tests
```

Preview locally: run `python3 -m http.server` in the repo root and open `http://localhost:8000/backtesting/`. Opening `index.html` directly from disk will not load the CSVs.

Run the tests: `npm i papaparse && node backtesting/tools/test.js`.
