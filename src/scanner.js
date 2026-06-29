import { SandwichDetector } from "./detector.js";
import { XrplTxEnricher } from "./enrich.js";
import { estimateXrpImpact } from "./estimates.js";
import { summarizeAlert } from "./output.js";
import { XrplDataRestClient } from "./rest-client.js";
import { chooseTickerInterval } from "./ticker-interval.js";

export async function scanLedgerRange(config, options = {}) {
  const restClient = new XrplDataRestClient({ baseUrl: config.restUrl });
  const startLedger = Number(options.startLedger);
  const endLedger = Number(options.endLedger);
  if (!Number.isInteger(startLedger) || !Number.isInteger(endLedger)) {
    throw new Error("startLedger and endLedger are required integer ledger indexes.");
  }
  if (endLedger < startLedger) {
    throw new Error("endLedger must be greater than or equal to startLedger.");
  }

  const [startClose, endClose] = await Promise.all([
    restClient.getLedgerCloseTime(startLedger),
    restClient.getLedgerCloseTime(endLedger)
  ]);

  const start = startClose.closed;
  const end = endClose.closed;
  const interval = options.interval || chooseTickerInterval(start, end);
  const tickers = await restClient.getTickerDataAll({
    interval,
    date: end,
    minExchanges: numberOption(options.minExchanges, 10),
    onlyAmm: options.onlyAmm,
    excludeAmm: options.excludeAmm
  });

  const maxPairs = numberOption(options.pairs, 25);
  const limit = numberOption(options.limit, 1000);
  const detectorOptions = {
    ...config.detector,
    minProfitBps: numberOption(options.minProfitBps, config.detector.minProfitBps),
    maxLedgerGap: numberOption(options.maxLedgerGap, config.detector.maxLedgerGap),
    maxTxGap: numberOption(options.maxTxGap, config.detector.maxTxGap),
    minVictimVolumeRatio: numberOption(
      options.minVictimVolumeRatio,
      config.detector.minVictimVolumeRatio
    )
  };

  const activePairs = tickers
    .sort((a, b) => Number(b.exchanges || 0) - Number(a.exchanges || 0))
    .slice(0, maxPairs);

  const alerts = [];
  const pairSummaries = [];

  for (const ticker of activePairs) {
    const detector = new SandwichDetector(detectorOptions);
    const trades = await restClient.getExchanges({
      base: ticker.base,
      counter: ticker.counter,
      start,
      end,
      limit,
      onlyAmm: options.onlyAmm,
      excludeAmm: options.excludeAmm
    });

    const inRangeTrades = trades.filter(
      (trade) => trade.ledgerIndex >= startLedger && trade.ledgerIndex <= endLedger
    );
    inRangeTrades.sort(compareTrades);

    let pairAlerts = 0;
    for (const trade of inRangeTrades) {
      for (const alert of detector.ingest(trade)) {
        const enriched = enrichAlertSummary(summarizeAlert(alert));
        alerts.push(enriched);
        pairAlerts += 1;
      }
    }

    pairSummaries.push({
      pair: `${ticker.base}|${ticker.counter}`,
      exchangeCount: Number(ticker.exchanges || 0),
      scannedTrades: inRangeTrades.length,
      alertCount: pairAlerts
    });
  }

  alerts.sort((a, b) => {
    const bProfit = b.impact.attackerProfitXrp ?? -Infinity;
    const aProfit = a.impact.attackerProfitXrp ?? -Infinity;
    if (bProfit !== aProfit) return bProfit - aProfit;
    return b.confidence - a.confidence;
  });

  const verifyLimit = numberOption(options.verifyLimit, 30);
  const verifiedAlerts =
    verifyLimit > 0
      ? await verifyTopAlerts(config, alerts.slice(0, verifyLimit)).then((verified) => [
          ...verified,
          ...alerts.slice(verifyLimit)
        ])
      : alerts;

  const totals = summarizeTotals(verifiedAlerts);

  return {
    range: {
      startLedger,
      endLedger,
      startCloseTime: start,
      endCloseTime: end,
      tickerInterval: interval
    },
    options: {
      pairs: maxPairs,
      limit,
      minExchanges: numberOption(options.minExchanges, 10),
      includeAmm: !options.excludeAmm,
      detector: detectorOptions
    },
    totals,
    pairSummaries,
    alerts: verifiedAlerts
  };
}

export async function getLatestLedger(config) {
  const restClient = new XrplDataRestClient({ baseUrl: config.restUrl });
  return restClient.getLatestLedgerIndex();
}

function enrichAlertSummary(alert) {
  const impact = estimateXrpImpact(alert);
  return {
    ...alert,
    impact: {
      ...impact,
      attackerProfitXrp:
        impact.attackerProfitXrp === null ? null : Number(impact.attackerProfitXrp.toFixed(6)),
      victimLossXrp: impact.victimLossXrp === null ? null : Number(impact.victimLossXrp.toFixed(6))
    },
    verification: {
      checked: false,
      orderVerified: null,
      ticketSignal: hasTicketSignal(alert)
    }
  };
}

async function verifyTopAlerts(config, alerts) {
  const enricher = new XrplTxEnricher({
    rpcUrl: config.xrplRpcUrl,
    enabled: Boolean(config.xrplRpcUrl)
  });

  const verified = [];
  for (const alert of alerts) {
    try {
      const [frontRun, victimTrade, backRun] = await Promise.all([
        enricher.enrich(alert.frontRun),
        enricher.enrich(alert.victimTrade),
        enricher.enrich(alert.backRun)
      ]);

      verified.push({
        ...alert,
        frontRun,
        victimTrade,
        backRun,
        verification: {
          checked: true,
          orderVerified: compareTrades(frontRun, victimTrade) < 0 && compareTrades(victimTrade, backRun) < 0,
          ticketSignal: hasTicketSignal({ frontRun, backRun }),
          frontRunTxResult: frontRun.txResult,
          victimTxResult: victimTrade.txResult,
          backRunTxResult: backRun.txResult
        }
      });
    } catch (error) {
      verified.push({
        ...alert,
        verification: {
          ...alert.verification,
          checked: true,
          orderVerified: null,
          error: error.message
        }
      });
    }
  }
  return verified;
}

function summarizeTotals(alerts) {
  const verified = alerts.filter((alert) => alert.verification.orderVerified === true);
  const xrpAlerts = alerts.filter((alert) => alert.impact.attackerProfitXrp !== null);
  const totalAttackerProfitXrp = xrpAlerts.reduce(
    (total, alert) => total + Math.max(0, alert.impact.attackerProfitXrp),
    0
  );
  const totalVictimLossXrp = xrpAlerts.reduce(
    (total, alert) => total + Math.max(0, alert.impact.victimLossXrp ?? 0),
    0
  );

  return {
    alerts: alerts.length,
    verifiedOrderAlerts: verified.length,
    ticketSignalAlerts: alerts.filter((alert) => alert.verification.ticketSignal).length,
    totalAttackerProfitXrp: Number(totalAttackerProfitXrp.toFixed(6)),
    totalVictimLossXrp: Number(totalVictimLossXrp.toFixed(6))
  };
}

function hasTicketSignal(alert) {
  return Boolean(alert.frontRun.ticketSequence || alert.backRun.ticketSequence);
}

function numberOption(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compareTrades(a, b) {
  if (a.ledgerIndex !== b.ledgerIndex) return a.ledgerIndex - b.ledgerIndex;
  if (a.txIndex !== undefined && b.txIndex !== undefined && a.txIndex !== b.txIndex) {
    return a.txIndex - b.txIndex;
  }
  return a.txHash.localeCompare(b.txHash);
}
