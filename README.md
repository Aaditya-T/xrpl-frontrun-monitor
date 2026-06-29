# XRPL Front-Run Monitor

Live and backfill monitor for probable sandwich/front-running on the XRPL DEX.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## Data source

Trade and ledger history come from the free [XRPL Data API](https://xrpldata.inftf.org/docs) operated by [InFTF](https://inftf.org/). Thank you to InFTF for making this data publicly available.

The first version uses XRPLData trade events as the primary signal:

- Paid stream: `wss://stream.xrpldata.com` with `x-api-key`
- Free REST backfill: `https://xrpldata.inftf.org/v1/iou/exchanges/{base}/{counter}`
- Optional XRPL JSON-RPC enrichment for `Sequence`, `TicketSequence`, and transaction type

## Why This Shape

Sandwiches on the XRPL DEX are observable as ordered trade sequences:

1. Attacker takes one side of a pair.
2. A victim takes the same side shortly after, moving the execution rate.
3. The same attacker takes the opposite side shortly after and exits at a better rate.

The detector scores the pattern using:

- same taker on front-run and back-run legs
- opposite trade sides for the same pair
- victim trade between both attacker legs by `ledger_index` and `tx_index`
- positive round-trip edge in basis points
- same-ledger grouping
- optional adjacent `Sequence`, `TicketSequence`, or `OfferSequence`
- victim size relative to attacker size

It intentionally emits `probable_sandwich` alerts rather than pretending every match is proven theft. Real examples will let us tune false positives.

## Setup

Use Node 20+.

```bash
cp .env.example .env
```

Then export the values in your shell, or source them before running:

```bash
set -a
source .env
set +a
```

## Live Monitor

```bash
npm start
```

By default this subscribes to:

```json
{
  "command": "subscribe",
  "stream": "trades",
  "base": "all",
  "quote": "all",
  "type": "all",
  "exchange": "dex"
}
```

Each alert is written as one JSON line to stdout. Operational logs go to stderr.

## Dashboard

Start the local dashboard:

```bash
npm run dashboard
```

Then open:

```text
http://localhost:8787
```

The dashboard lets users choose a calendar date/time range, or quick ranges like `1d`, `7d`, `30d`, and `90d`. It scans active XRPL DEX/AMM pairs near that range and shows:

- estimated victim accounts
- attacker accounts
- front-run, victim, and back-run transaction hashes
- estimated attacker profit in XRP for XRP pairs
- estimated victim loss in XRP for XRP pairs
- same-ledger vs near-ledger sandwich signals
- optional advanced ledger overrides

Profit/loss values are estimates. For pairs quoted in XRP, attacker profit is estimated from the XRP cashflow of the front/back legs. Victim loss is estimated from price movement between the suspected front-run and victim leg. For non-XRP pairs the dashboard reports `n/a`.

The public dashboard performs XRPLData REST calls directly from the visitor's browser. That keeps free API rate limits per visitor instead of centralizing usage on the host server. Date/time selections are converted to ledger indexes with:

```text
GET /v1/ledgers/ledger_index?date=...
```

## Backfill

The free REST API uses `_` between issuer and currency, while the paid stream docs show `+` in subscription examples.

```bash
npm run backfill -- \
  --base XRP \
  --counter rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq_USD \
  --start 2026-01-01T00:00:00Z \
  --end 2026-01-01T01:00:00Z \
  --limit 1000
```

## Scan Active Pairs

This asks the free REST API for active pairs and scans the busiest ones:

```bash
npm run scan -- --pairs 10 --interval 1h --min-exchanges 20
```

REST backfills do not include `tx_index`, so same-ledger ordering is approximate in scan/backfill mode. Treat these as candidate alerts unless verified against raw ledger transaction order.

## Detection Knobs

Environment variables:

- `DETECTOR_MIN_PROFIT_BPS`: minimum estimated entry/exit edge, default `3`
- `DETECTOR_MAX_LEDGER_GAP`: max ledger span between attacker legs, default `1`
- `DETECTOR_MAX_TX_GAP`: max transaction-index distance inside one ledger, default `40`
- `DETECTOR_MIN_VICTIM_VOLUME_RATIO`: victim volume vs front-run volume, default `0.25`
- `DETECTOR_HISTORY_SIZE`: rolling trade history, default `2500`
- `XRPL_ENRICH_TX`: set to `true` to fetch raw tx details for `Sequence` and `TicketSequence`

For broad `all/all` monitoring, leave `XRPL_ENRICH_TX=false`. For a targeted pair or known attack window, turn it on.

## Next Useful Inputs

The monitor will get much sharper with a handful of known attacks:

- three transaction hashes for the front-run, victim, and back-run legs
- whether they use `TicketSequence` or normal `Sequence`
- pair and approximate time
- any known attacker addresses

Those examples can become regression fixtures and address-clustering rules.

## License

MIT — see [LICENSE](LICENSE).
