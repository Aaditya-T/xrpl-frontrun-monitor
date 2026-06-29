import "./types.js";

const EPSILON = 1e-12;

export class SandwichDetector {
  constructor(options = {}) {
    this.options = {
      minProfitBps: options.minProfitBps ?? 3,
      maxLedgerGap: options.maxLedgerGap ?? 1,
      maxTxGap: options.maxTxGap ?? 40,
      minVictimVolumeRatio: options.minVictimVolumeRatio ?? 0.25,
      historySize: options.historySize ?? 2500
    };
    /** @type {import("./types.js").ClassifiedTrade[]} */
    this.history = [];
    this.seenAlertKeys = new Set();
  }

  /**
   * @param {import("./types.js").TradeEvent} trade
   * @returns {import("./types.js").SandwichAlert[]}
   */
  ingest(trade) {
    const classified = classifyTrade(trade);
    if (classified.side === "unknown") {
      this.push(classified);
      return [];
    }

    const alerts = this.findAlertsEndingAt(classified);
    this.push(classified);
    return alerts;
  }

  push(trade) {
    this.history.push(trade);
    if (this.history.length > this.options.historySize) {
      this.history.splice(0, this.history.length - this.options.historySize);
      if (this.seenAlertKeys.size > this.options.historySize * 4) {
        this.seenAlertKeys = new Set([...this.seenAlertKeys].slice(-this.options.historySize * 2));
      }
    }
  }

  findAlertsEndingAt(backRun) {
    const alerts = [];
    const candidates = this.history.filter((trade) => {
      if (trade.pair !== backRun.pair) return false;
      if (trade.taker !== backRun.taker) return false;
      if (trade.txHash === backRun.txHash) return false;
      if (trade.side === backRun.side || trade.side === "unknown") return false;
      return isCloseEnough(trade, backRun, this.options);
    });

    for (const frontRun of candidates.reverse()) {
      const victims = this.history.filter((trade) => {
        if (trade.pair !== backRun.pair) return false;
        if (trade.txHash === frontRun.txHash || trade.txHash === backRun.txHash) return false;
        if (trade.taker === backRun.taker) return false;
        if (trade.side !== frontRun.side) return false;
        if (!isBetween(frontRun, trade, backRun)) return false;
        if (trade.volumeBase < frontRun.volumeBase * this.options.minVictimVolumeRatio) return false;
        return true;
      });

      for (const victim of victims) {
        const alert = scoreSandwich(frontRun, victim, backRun, this.options);
        if (!alert) continue;

        const key = `${frontRun.txHash}:${victim.txHash}:${backRun.txHash}`;
        if (this.seenAlertKeys.has(key)) continue;
        this.seenAlertKeys.add(key);
        alerts.push(alert);
      }
    }

    return alerts.sort((a, b) => b.confidence - a.confidence);
  }
}

export function classifyTrade(trade) {
  let side = "unknown";
  if (trade.taker && trade.taker === trade.buyer) side = "buy_base";
  if (trade.taker && trade.taker === trade.seller) side = "sell_base";

  return {
    ...trade,
    side,
    sortKey: sortKey(trade),
    participantKey: [trade.taker, trade.buyer, trade.seller, trade.provider].filter(Boolean).join("|")
  };
}

function scoreSandwich(frontRun, victimTrade, backRun, options) {
  const estimatedProfitBps = estimateProfitBps(frontRun, backRun);
  if (estimatedProfitBps < options.minProfitBps) return null;

  const reasons = [
    "same attacker taker submitted two opposite-side trades",
    "victim trade sits between attacker trades in ledger order",
    `estimated round-trip edge ${estimatedProfitBps.toFixed(2)} bps`
  ];

  let confidence = 0.55;
  confidence += Math.min(0.2, estimatedProfitBps / 250);

  if (frontRun.ledgerIndex === victimTrade.ledgerIndex && victimTrade.ledgerIndex === backRun.ledgerIndex) {
    confidence += 0.15;
    reasons.push("all three trades landed in the same ledger");
  }

  if (hasTicketOrSequenceSignal(frontRun, backRun)) {
    confidence += 0.1;
    reasons.push("attacker transactions expose adjacent Sequence/TicketSequence ordering");
  }

  if (victimTrade.volumeBase >= frontRun.volumeBase) {
    confidence += 0.05;
    reasons.push("victim trade is at least as large as the front-run leg");
  }

  return {
    type: "probable_sandwich",
    confidence: Number(Math.min(confidence, 0.98).toFixed(3)),
    reasons,
    pair: frontRun.pair,
    attacker: frontRun.taker,
    victim: victimTrade.taker,
    entryRate: frontRun.rate,
    victimRate: victimTrade.rate,
    exitRate: backRun.rate,
    estimatedProfitBps: Number(estimatedProfitBps.toFixed(4)),
    ledgerSpan: backRun.ledgerIndex - frontRun.ledgerIndex,
    frontRun,
    victimTrade,
    backRun
  };
}

function estimateProfitBps(frontRun, backRun) {
  if (frontRun.rate <= EPSILON || backRun.rate <= EPSILON) return 0;

  if (frontRun.side === "buy_base" && backRun.side === "sell_base") {
    return ((backRun.rate - frontRun.rate) / frontRun.rate) * 10_000;
  }

  if (frontRun.side === "sell_base" && backRun.side === "buy_base") {
    return ((frontRun.rate - backRun.rate) / frontRun.rate) * 10_000;
  }

  return 0;
}

function hasTicketOrSequenceSignal(frontRun, backRun) {
  if (frontRun.ticketSequence !== undefined && backRun.ticketSequence !== undefined) {
    return Math.abs(backRun.ticketSequence - frontRun.ticketSequence) <= 2;
  }
  if (frontRun.sequence !== undefined && backRun.sequence !== undefined) {
    return Math.abs(backRun.sequence - frontRun.sequence) <= 2;
  }
  if (frontRun.offerSequence !== undefined && backRun.offerSequence !== undefined) {
    return Math.abs(backRun.offerSequence - frontRun.offerSequence) <= 2;
  }
  return false;
}

function isCloseEnough(a, b, options) {
  const ledgerGap = Math.abs(b.ledgerIndex - a.ledgerIndex);
  if (ledgerGap > options.maxLedgerGap) return false;
  if (ledgerGap === 0 && Math.abs(b.txIndex - a.txIndex) > options.maxTxGap) return false;
  return compareOrder(a, b) < 0;
}

function isBetween(before, middle, after) {
  return compareOrder(before, middle) < 0 && compareOrder(middle, after) < 0;
}

function compareOrder(a, b) {
  if (a.ledgerIndex !== b.ledgerIndex) return a.ledgerIndex - b.ledgerIndex;
  if (a.txIndex !== b.txIndex) return a.txIndex - b.txIndex;
  return a.txHash.localeCompare(b.txHash);
}

function sortKey(trade) {
  return `${String(trade.ledgerIndex).padStart(12, "0")}:${String(trade.txIndex).padStart(6, "0")}:${trade.txHash}`;
}
