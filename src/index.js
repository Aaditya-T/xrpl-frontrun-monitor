#!/usr/bin/env node
import process from "node:process";
import { loadConfig } from "./config.js";
import { SandwichDetector } from "./detector.js";
import { XrplTxEnricher } from "./enrich.js";
import { summarizeAlert, writeAlert } from "./output.js";
import { XrplDataRestClient } from "./rest-client.js";
import { buildTradeSubscription, XrplDataStreamClient } from "./stream-client.js";

const command = process.argv[2] || "stream";
const config = loadConfig();

if (command === "stream") {
  await runStream(config);
} else if (command === "backfill") {
  await runBackfill(config, parseBackfillArgs(process.argv.slice(3)));
} else if (command === "scan") {
  await runScan(config, parseScanArgs(process.argv.slice(3)));
} else {
  usage();
  process.exitCode = 1;
}

async function runStream(config) {
  const detector = new SandwichDetector(config.detector);
  const enricher = new XrplTxEnricher({
    rpcUrl: config.xrplRpcUrl,
    enabled: config.enrichTx && Boolean(config.xrplRpcUrl)
  });

  const client = new XrplDataStreamClient({
    url: config.streamUrl,
    apiKey: config.apiKey,
    subscription: buildTradeSubscription(config)
  });

  client.on("open", () => {
    process.stderr.write(`connected ${config.streamUrl}\n`);
  });

  client.on("status", (status) => {
    process.stderr.write(`stream status ${JSON.stringify(status)}\n`);
  });

  client.on("trade", async (trade) => {
    try {
      const enriched = await enricher.enrich(trade);
      for (const alert of detector.ingest(enriched)) {
        writeAlert(summarizeAlert(alert));
      }
    } catch (error) {
      process.stderr.write(`trade processing error: ${error.message}\n`);
    }
  });

  client.on("error", (error) => {
    process.stderr.write(`stream error: ${error.message || String(error)}\n`);
  });

  process.once("SIGINT", () => {
    client.close();
    process.exit(0);
  });

  client.connect();
}

async function runBackfill(config, args) {
  if (!args.base || !args.counter) {
    throw new Error("backfill requires --base and --counter, e.g. --base XRP --counter rhub8..._USD");
  }

  const detector = new SandwichDetector(config.detector);
  const client = new XrplDataRestClient({ baseUrl: config.restUrl });
  const trades = await client.getExchanges({
    base: args.base,
    counter: args.counter,
    start: args.start,
    end: args.end,
    limit: args.limit,
    skip: args.skip,
    onlyAmm: args.onlyAmm,
    excludeAmm: args.excludeAmm
  });

    trades.sort(compareTrades);

  for (const trade of trades) {
    for (const alert of detector.ingest(trade)) {
      writeAlert(summarizeAlert(alert));
    }
  }
}

async function runScan(config, args) {
  const client = new XrplDataRestClient({ baseUrl: config.restUrl });
  const tickers = await client.getTickerDataAll({
    interval: args.interval,
    minExchanges: args.minExchanges,
    excludeAmm: args.excludeAmm,
    onlyAmm: args.onlyAmm
  });

  const activePairs = tickers
    .sort((a, b) => Number(b.exchanges || 0) - Number(a.exchanges || 0))
    .slice(0, args.pairs);

  process.stderr.write(`scanning ${activePairs.length} active pairs\n`);

  let totalAlerts = 0;
  for (const ticker of activePairs) {
    const detector = new SandwichDetector(config.detector);
    const pairLabel = `${ticker.base}|${ticker.counter}`;
    process.stderr.write(`pair ${pairLabel} exchanges=${ticker.exchanges}\n`);

    const trades = await client.getExchanges({
      base: ticker.base,
      counter: ticker.counter,
      start: ticker.date_from,
      end: ticker.date_to,
      limit: args.limit,
      excludeAmm: args.excludeAmm,
      onlyAmm: args.onlyAmm
    });

    trades.sort(compareTrades);

    for (const trade of trades) {
      for (const alert of detector.ingest(trade)) {
        totalAlerts += 1;
        writeAlert(summarizeAlert(alert));
      }
    }
  }

  process.stderr.write(`scan complete alerts=${totalAlerts}\n`);
}

function parseBackfillArgs(argv) {
  const args = { limit: 1000, skip: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith("--")) continue;

    if (key === "--only-amm") {
      args.onlyAmm = true;
      continue;
    }
    if (key === "--exclude-amm") {
      args.excludeAmm = true;
      continue;
    }

    i += 1;
    const name = key.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    args[name] = name === "limit" || name === "skip" ? Number(value) : value;
  }
  return args;
}

function compareTrades(a, b) {
  if (a.ledgerIndex !== b.ledgerIndex) return a.ledgerIndex - b.ledgerIndex;
  if (a.txIndex !== b.txIndex) return a.txIndex - b.txIndex;
  return a.txHash.localeCompare(b.txHash);
}

function parseScanArgs(argv) {
  const args = { interval: "1h", minExchanges: 10, pairs: 10, limit: 1000 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith("--")) continue;

    if (key === "--only-amm") {
      args.onlyAmm = true;
      continue;
    }
    if (key === "--exclude-amm") {
      args.excludeAmm = true;
      continue;
    }

    i += 1;
    const name = key.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    args[name] = ["minExchanges", "pairs", "limit"].includes(name) ? Number(value) : value;
  }
  return args;
}

function usage() {
  process.stderr.write(`Usage:
  npm start
  npm run backfill -- --base XRP --counter rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq_USD --start 2026-01-01T00:00:00Z --end 2026-01-01T01:00:00Z
  node ./src/index.js scan --pairs 10 --interval 1h --min-exchanges 20

Environment:
  XRPLDATA_API_KEY       API key for wss://stream.xrpldata.com
  XRPL_BASE             Stream base filter, default all
  XRPL_QUOTE            Stream quote filter, default all
  XRPL_EXCHANGE         dex or amm, default dex
  XRPL_RPC_URL          Optional rippled JSON-RPC endpoint for Sequence/TicketSequence enrichment
`);
}
