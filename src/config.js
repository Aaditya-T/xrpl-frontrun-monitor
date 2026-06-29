import process from "node:process";
import fs from "node:fs";
import path from "node:path";

const DEFAULTS = {
  streamUrl: "wss://stream.xrpldata.com",
  restUrl: "https://xrpldata.inftf.org/v1",
  xrplRpcUrl: "https://s1.ripple.com:51234/",
  enrichTx: false,
  base: "all",
  quote: "all",
  exchange: "dex",
  streamType: "all",
  detector: {
    minProfitBps: 3,
    maxLedgerGap: 1,
    maxTxGap: 40,
    minVictimVolumeRatio: 0.25,
    historySize: 2500
  }
};

export function loadConfig(env = process.env) {
  const fileEnv = loadDotEnv();
  const mergedEnv = { ...fileEnv, ...env };

  return {
    apiKey: mergedEnv.XRPLDATA_API_KEY || "",
    streamUrl: mergedEnv.XRPLDATA_STREAM_URL || DEFAULTS.streamUrl,
    restUrl: mergedEnv.XRPLDATA_REST_URL || DEFAULTS.restUrl,
    xrplRpcUrl: mergedEnv.XRPL_RPC_URL || DEFAULTS.xrplRpcUrl,
    enrichTx: booleanEnv(mergedEnv.XRPL_ENRICH_TX, DEFAULTS.enrichTx),
    base: mergedEnv.XRPL_BASE || DEFAULTS.base,
    quote: mergedEnv.XRPL_QUOTE || DEFAULTS.quote,
    exchange: mergedEnv.XRPL_EXCHANGE || DEFAULTS.exchange,
    streamType: mergedEnv.XRPL_STREAM_TYPE || DEFAULTS.streamType,
    detector: {
      minProfitBps: numberEnv(mergedEnv.DETECTOR_MIN_PROFIT_BPS, DEFAULTS.detector.minProfitBps),
      maxLedgerGap: numberEnv(mergedEnv.DETECTOR_MAX_LEDGER_GAP, DEFAULTS.detector.maxLedgerGap),
      maxTxGap: numberEnv(mergedEnv.DETECTOR_MAX_TX_GAP, DEFAULTS.detector.maxTxGap),
      minVictimVolumeRatio: numberEnv(
        mergedEnv.DETECTOR_MIN_VICTIM_VOLUME_RATIO,
        DEFAULTS.detector.minVictimVolumeRatio
      ),
      historySize: numberEnv(mergedEnv.DETECTOR_HISTORY_SIZE, DEFAULTS.detector.historySize)
    }
  };
}

function loadDotEnv() {
  const filePath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(filePath)) return {};

  const values = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    values[key] = unquote(rawValue);
  }
  return values;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function numberEnv(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanEnv(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}
