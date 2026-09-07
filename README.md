# SASE Berza

A Möbius mini-app for exploring Sarajevo Stock Exchange symbols, historical
average prices, and recent trading sessions in BAM (KM).

## Features

- Search by stock symbol or company name, with a built-in list if discovery fails.
- Select periods from one month to five years.
- View average-price charts and the latest 30 sessions.
- Keep the chart, summary, and table in place during loading and errors.
- Retry failed requests; shorter-range fallbacks are explicitly labelled.

## Install and run

This is a **Möbius mini-app**, not a standalone Node website. Möbius supplies
React, Recharts, theme variables, the sandboxed app frame, and its authenticated
external-read proxy. No SASE key is required. Internet access is required.

For a private repository, first authenticate GitHub using your own account with
access to this repository, then clone it into your Möbius instance:

```sh
gh repo clone hamzamerzic/sase-berza /data/apps/sase-berza
python "$SCRIPTS_DIR/apply_app.py" /data/apps/sase-berza
```

Use an unused destination on a fresh instance. Do not clone over an existing
app or overwrite local changes. The manifest is at the repository root for
Möbius package tooling. Private raw URLs require authentication; do not assume
an anonymous App Store URL can install this private repository.

## Develop

- `index.jsx`: app UI and request lifecycle.
- `market.js`: SASE feed access, symbol/XML parsing, dates, and chart sampling.
- `mobius.json`: portable package manifest.
- `tests/market.test.js`: dependency-free unit tests using Node's test runner.

```sh
npm test
python "$SCRIPTS_DIR/validate-app.py" /data/apps/sase-berza
python "$SCRIPTS_DIR/apply_app.py" /data/apps/sase-berza
```

Möbius bundles runtime dependencies; there is no separate npm build or server.
Apply each coherent source revision to update the running app.

## Data and privacy

Market data comes from SASE's `FeedServices/HandlerChart.ashx`, read through
Möbius's proxy. This package contains no market snapshots, owner records,
credentials, chats, or runtime data. It does not persist a portfolio or place
trades. App credentials are provided by Möbius at runtime, never committed.

The app displays the dates returned by SASE; data availability and freshness
are controlled by the feed. Long histories are sampled for chart rendering,
while summary calculations and the recent-session table use the full response.
Historical prices are informational, not a live quote or trading service.
