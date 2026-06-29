import { chooseTickerInterval, QUICK_RANGE_PRESETS, tickerIntervalHint } from "./ticker-interval.js";

const REST_URL = "https://xrpldata.inftf.org/v1";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_DEFAULT_MAX = 180;
const RATE_LIMIT_RESERVE = 4;

const DEFAULT_DETECTOR = {
  minProfitBps: 3,
  maxLedgerGap: 1,
  maxTxGap: 60,
  maxCrossLedgerTxGap: 60,
  minVictimVolumeRatio: 0.15,
  minVictimRateMoveBps: 0,
  minRoundTripVolumeRatio: 0.5,
  historySize: 2500
};

const state = {
  alerts: [],
  pairSummaries: [],
  selectedIndex: null,
  page: 1,
  pageSize: 25,
  rateLimit: {}
};

const form = document.querySelector("#scan-form");
const statusEl = document.querySelector("#status");
const scanButton = document.querySelector("#scan-button");
const quickRangesEl = document.querySelector(".quick-ranges");
const alertsBody = document.querySelector("#alerts-body");
const details = document.querySelector("#details");
const progressPanel = document.querySelector("#progress-panel");
const progressLabel = document.querySelector("#progress-label");
const progressPercent = document.querySelector("#progress-percent");
const progressBar = document.querySelector("#progress-bar");
const progressDetail = document.querySelector("#progress-detail");
const rateLimitEl = document.querySelector("#rate-limit");
const pager = document.querySelector("#pager");
const prevPage = document.querySelector("#prev-page");
const nextPage = document.querySelector("#next-page");
const pageLabel = document.querySelector("#page-label");
const guideDialog = document.querySelector("#guide-dialog");
const guideOpen = document.querySelector("#guide-open");
const guideClose = document.querySelector("#guide-close");

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

guideOpen.addEventListener("click", () => guideDialog.showModal());
guideClose.addEventListener("click", () => guideDialog.close());
guideDialog.addEventListener("click", (event) => {
  if (event.target === guideDialog) guideDialog.close();
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await runScan();
});

quickRangesEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-range-days]");
  if (!button) return;
  setQuickRange(Number(button.dataset.rangeDays));
  quickRangesEl.querySelectorAll("[data-range-days]").forEach((item) => {
    item.classList.toggle("active", item === button);
  });
  updateRangeHint();
});

document.querySelector("#start-time").addEventListener("change", updateRangeHint);
document.querySelector("#end-time").addEventListener("change", updateRangeHint);

document.querySelector("#page-size").addEventListener("change", () => {
  state.pageSize = numberValue("#page-size");
  state.page = 1;
  state.selectedIndex = null;
  renderAlerts();
});

prevPage.addEventListener("click", () => {
  state.page = Math.max(1, state.page - 1);
  state.selectedIndex = null;
  renderAlerts();
});

nextPage.addEventListener("click", () => {
  state.page = Math.min(pageCount(), state.page + 1);
  state.selectedIndex = null;
  renderAlerts();
});

async function boot() {
  renderQuickRanges();
  progressPanel.hidden = true;
  try {
    const latest = await xrplDataJson("/ledgers/ledger_index");
    statusEl.textContent = `Latest ledger ${latest.ledger_index}`;
    state.latestLedger = latest.ledger_index;
    state.latestCloseTime = latest.closed;
    setQuickRange(1);
    quickRangesEl.querySelector('[data-range-days="1"]')?.classList.add("active");
    updateRangeHint();
  } catch (error) {
    statusEl.textContent = `Latest ledger unavailable: ${error.message}`;
    setQuickRange(1);
    updateRangeHint();
  }
}

function renderQuickRanges() {
  quickRangesEl.innerHTML = QUICK_RANGE_PRESETS.map(
    (preset) => `<button type="button" data-range-days="${preset.days}">${preset.label}</button>`
  ).join("");
}

function updateRangeHint() {
  const startInput = document.querySelector("#start-time").value;
  const endInput = document.querySelector("#end-time").value;
  if (!startInput || !endInput) return;

  try {
    const start = localDateTimeToIso(startInput);
    const end = localDateTimeToIso(endInput);
    const hint = tickerIntervalHint(start, end);
    const ledgerText = state.latestLedger ? `Latest ledger ${state.latestLedger}` : "Ledger ready";
    statusEl.textContent = hint ? `${ledgerText} · ${hint}` : ledgerText;
  } catch {
    // Ignore while the user is editing an incomplete range.
  }
}

async function runScan() {
  const payload = formPayload();
  const progress = createProgress();
  const gate = new RateGate();

  scanButton.disabled = true;
  scanButton.textContent = "Scanning";
  statusEl.textContent = "Direct browser scan running";
  progressPanel.hidden = false;
  renderEmpty("Scanning...");
  renderDetails(null);

  try {
    const result = await scanLedgerRange(payload, progress, gate);
    state.alerts = result.alerts || [];
    state.pairSummaries = result.pairSummaries || [];
    state.selectedIndex = null;
    state.page = 1;
    state.pageSize = numberValue("#page-size");

    renderMetrics(result.totals);
    renderRange(result.range);
    renderAlerts();
    updateProgress(progress, 100, "Scan complete", `${state.alerts.length} candidates found`);
    statusEl.textContent = `Scanned ${result.pairSummaries.length} pairs from your browser`;
  } catch (error) {
    renderEmpty(error.message);
    renderMetrics();
    renderRange();
    updateProgress(progress, 100, "Scan failed", error.message);
    statusEl.textContent = "Scan failed";
  } finally {
    scanButton.disabled = false;
    scanButton.textContent = "Run Scan";
  }
}

async function scanLedgerRange(options, progress, gate) {
  updateProgress(progress, 4, "Resolving time range", "Mapping timestamps to ledger indexes");
  const resolvedRange = await resolveScanRange(options, gate);
  const { startLedger, endLedger, start, end } = resolvedRange;
  const interval = chooseTickerInterval(start, end);

  updateProgress(progress, 10, "Finding active pairs", "Loading ticker data");
  const tickerParams = new URLSearchParams({
    interval,
    date: end,
    min_exchanges: String(options.minExchanges)
  });
  if (options.excludeAmm) tickerParams.set("exclude_amm", "true");
  const tickers = await xrplDataJson(`/iou/ticker_data/all?${tickerParams}`, {}, gate);
  const activePairs = (Array.isArray(tickers) ? tickers : [])
    .sort((a, b) => Number(b.exchanges || 0) - Number(a.exchanges || 0))
    .slice(0, options.pairs);

  const detectorOptions = {
    ...DEFAULT_DETECTOR,
    minProfitBps: options.minProfitBps,
    maxLedgerGap: options.maxLedgerGap,
    maxTxGap: options.maxTxGap,
    maxCrossLedgerTxGap: options.maxCrossLedgerTxGap ?? DEFAULT_DETECTOR.maxCrossLedgerTxGap,
    minVictimVolumeRatio: options.minVictimVolumeRatio,
    minRoundTripVolumeRatio: options.minRoundTripVolumeRatio ?? DEFAULT_DETECTOR.minRoundTripVolumeRatio
  };

  const alerts = [];
  const pairSummaries = [];
  let completedPairs = 0;

  const pairConcurrency = Math.min(12, Math.max(3, gate.recommendedConcurrency(activePairs.length)));
  await mapLimit(activePairs, pairConcurrency, async (ticker) => {
    const pairLabel = `${ticker.base}|${ticker.counter}`;
    updateProgress(
      progress,
      12 + (completedPairs / Math.max(1, activePairs.length)) * 48,
      "Fetching pair exchanges",
      `${completedPairs + 1}/${activePairs.length}: ${shortPair(pairLabel)}`
    );

    const detector = new SandwichDetector(detectorOptions);
    const trades = await getAllExchanges(
      {
        base: ticker.base,
        counter: ticker.counter,
        start,
        end,
        excludeAmm: options.excludeAmm,
        limit: 1000
      },
      gate
    );

    const inRangeTrades = aggregateTradesByTransaction(
      trades.filter((trade) => trade.ledgerIndex >= startLedger && trade.ledgerIndex <= endLedger)
    )
      .sort(compareTrades);

    let pairAlerts = 0;
    for (const trade of inRangeTrades) {
      for (const alert of detector.ingest(trade)) {
        alerts.push(enrichAlertSummary(summarizeAlert(alert)));
        pairAlerts += 1;
      }
    }

    pairSummaries.push({
      pair: pairLabel,
      exchangeCount: Number(ticker.exchanges || 0),
      scannedTrades: inRangeTrades.length,
      alertCount: pairAlerts
    });
    completedPairs += 1;
  });

  alerts.sort(sortAlerts);

  const finalAlerts = alerts.sort(sortAlerts);

  updateProgress(progress, 94, "Summarizing results", "Computing XRP estimates");

  return {
    range: {
      startLedger,
      endLedger,
      startCloseTime: start,
      endCloseTime: end,
      tickerInterval: interval
    },
    totals: summarizeTotals(finalAlerts),
    pairSummaries: pairSummaries.sort((a, b) => b.alertCount - a.alertCount || b.scannedTrades - a.scannedTrades),
    alerts: finalAlerts.sort(sortAlerts)
  };
}

async function getAllExchanges(options, gate) {
  const all = [];
  let skip = 0;
  let page = 0;
  const maxPages = 8;

  while (page < maxPages) {
    const params = new URLSearchParams({
      start: options.start,
      end: options.end,
      limit: String(options.limit),
      skip: String(skip)
    });
    if (options.excludeAmm) params.set("exclude_amm", "true");

    const path = `/iou/exchanges/${encodeURIComponent(options.base)}/${encodeURIComponent(options.counter)}?${params}`;
    const { data, hasMore } = await xrplData(path, {}, gate);
    const exchanges = Array.isArray(data) ? data : [];
    all.push(
      ...exchanges
        .map((exchange, index) => normalizeRestExchange(exchange, `${options.base}|${options.counter}`, skip + index))
        .filter(Boolean)
    );

    if ((!hasMore && exchanges.length < options.limit) || exchanges.length === 0) break;
    skip += exchanges.length;
    page += 1;
  }

  return all;
}

async function xrplDataJson(path, options = {}, gate = new RateGate()) {
  return (await xrplData(path, options, gate)).data;
}

async function xrplData(path, options = {}, gate = new RateGate()) {
  await gate.acquire();
  const response = await fetch(`${REST_URL}${path}`, options);
  gate.noteHeaders(response.headers);

  if (response.status === 429) {
    await gate.note429();
    return xrplData(path, options, gate);
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || `XRPLData ${response.status}`);

  return {
    data,
    hasMore: response.headers.get("x-has-more-data") === "true"
  };
}

class RateGate {
  constructor() {
    this.waitUntil = 0;
    this.windowStart = Date.now();
    this.usedInWindow = 0;
    this.serverLimit = null;
    this.serverRemaining = null;
    this.serverReset = null;
    state.rateLimit = {
      estimated: true,
      limit: RATE_LIMIT_DEFAULT_MAX,
      remaining: RATE_LIMIT_DEFAULT_MAX,
      resetAt: Date.now() + RATE_LIMIT_WINDOW_MS
    };
    renderRateLimit();
  }

  recommendedConcurrency(itemCount) {
    return Math.max(1, Math.min(12, this.budgetRemaining(), itemCount));
  }

  budgetRemaining() {
    if (this.serverRemaining !== null) return this.serverRemaining;
    this.rollWindowIfNeeded();
    return Math.max(0, RATE_LIMIT_DEFAULT_MAX - RATE_LIMIT_RESERVE - this.usedInWindow);
  }

  rollWindowIfNeeded() {
    if (Date.now() - this.windowStart >= RATE_LIMIT_WINDOW_MS) {
      this.windowStart = Date.now();
      this.usedInWindow = 0;
    }
  }

  async acquire() {
    await this.waitForCooldown();

    while (this.budgetRemaining() <= 0) {
      const waitMs = this.serverReset !== null
        ? this.serverReset * 1000 + 250
        : Math.max(250, RATE_LIMIT_WINDOW_MS - (Date.now() - this.windowStart) + 250);
      await this.pause(waitMs, "Rate limit window resetting");
      this.rollWindowIfNeeded();
      if (this.serverRemaining === null) {
        this.usedInWindow = 0;
        this.windowStart = Date.now();
      }
    }

    if (this.serverRemaining !== null) {
      this.serverRemaining = Math.max(0, this.serverRemaining - 1);
    } else {
      this.usedInWindow += 1;
    }
    this.syncRateLimitState();
  }

  async waitForCooldown() {
    const delay = this.waitUntil - Date.now();
    if (delay > 0) await this.pause(delay, "Rate limit cooldown");
  }

  async pause(ms, label) {
    if (ms >= 750) updateProgressDetail(`${label} (${formatDelay(ms)})`);
    await sleep(ms);
  }

  noteHeaders(headers) {
    const limit = readRateHeader(headers, "x-ratelimit-limit");
    const remaining = readRateHeader(headers, "x-ratelimit-remaining");
    const reset = readRateHeader(headers, "x-ratelimit-reset");

    if (limit !== null && limit > 0) this.serverLimit = limit;
    if (remaining !== null && remaining >= 0) this.serverRemaining = remaining;
    if (reset !== null && reset > 0) this.serverReset = reset;

    if (this.serverRemaining !== null) {
      state.rateLimit.estimated = false;
    }

    this.syncRateLimitState();
  }

  async note429() {
    const resetSeconds = this.serverReset ?? Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);
    this.waitUntil = Date.now() + resetSeconds * 1000 + 500;
    this.usedInWindow = RATE_LIMIT_DEFAULT_MAX;
    if (this.serverRemaining !== null) this.serverRemaining = 0;
    this.syncRateLimitState();
    await this.waitForCooldown();
  }

  syncRateLimitState() {
    state.rateLimit.limit = this.serverLimit ?? RATE_LIMIT_DEFAULT_MAX;
    state.rateLimit.remaining = this.budgetRemaining();
    state.rateLimit.resetAt = this.serverReset !== null
      ? Date.now() + this.serverReset * 1000
      : this.windowStart + RATE_LIMIT_WINDOW_MS;
    renderRateLimit();
  }
}

function readRateHeader(headers, name) {
  const raw = headers.get(name);
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function secondsUntilWindowReset(windowStart) {
  return Math.max(0, Math.ceil((RATE_LIMIT_WINDOW_MS - (Date.now() - windowStart)) / 1000));
}

function resetSecondsRemaining(resetAt) {
  if (!Number.isFinite(resetAt)) return null;
  return Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
}

let rateLimitCountdownTimer = null;

function ensureRateLimitCountdown() {
  if (rateLimitCountdownTimer) return;
  rateLimitCountdownTimer = setInterval(() => {
    renderRateLimit();
  }, 1000);
}

function formatDelay(ms) {
  if (ms < 1000) return `${Math.round(ms / 100) / 10}s`;
  return `${Math.ceil(ms / 1000)}s`;
}

class SandwichDetector {
  constructor(options = {}) {
    this.options = { ...DEFAULT_DETECTOR, ...options };
    this.history = [];
    this.seenAlertKeys = new Set();
  }

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
        if (!victimRateMovedAgainstTrade(frontRun, trade, this.options)) return false;
        return trade.volumeBase >= frontRun.volumeBase * this.options.minVictimVolumeRatio;
      });

      for (const victimTrade of victims) {
        const alert = tradeIncludesAccount(victimTrade, backRun.taker)
          ? scoreDirectFillSandwich(frontRun, victimTrade, backRun, this.options)
          : scoreSandwich(frontRun, victimTrade, backRun, this.options);
        if (!alert) continue;
        const key = `${alert.type}:${frontRun.txHash}:${victimTrade.txHash}:${backRun.txHash}`;
        if (this.seenAlertKeys.has(key)) continue;
        this.seenAlertKeys.add(key);
        alerts.push(alert);
      }
    }
    return alerts.sort((a, b) => b.confidence - a.confidence);
  }
}

function scoreSandwich(frontRun, victimTrade, backRun, options) {
  const estimatedProfitBps = estimateProfitBps(frontRun, backRun);
  if (estimatedProfitBps < options.minProfitBps) return null;

  const closedBaseVolume = closedRoundTripBaseVolume(frontRun, backRun, options);
  if (closedBaseVolume === null) return null;

  const reasons = [
    "same attacker taker submitted two opposite-side trades",
    "victim trade sits between attacker trades in ledger order",
    "victim execution rate moved against the victim after the attacker entry",
    "attacker back-run closes a meaningful amount of the front-run position",
    `estimated round-trip edge ${estimatedProfitBps.toFixed(2)} bps`
  ];
  let confidence = 0.55 + Math.min(0.2, estimatedProfitBps / 250);

  if (frontRun.ledgerIndex === victimTrade.ledgerIndex && victimTrade.ledgerIndex === backRun.ledgerIndex) {
    confidence += 0.15;
    reasons.push("all three trades landed in the same ledger");
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
    closedBaseVolume: Number(closedBaseVolume.toFixed(6)),
    ledgerSpan: backRun.ledgerIndex - frontRun.ledgerIndex,
    frontRun,
    victimTrade,
    backRun
  };
}

function scoreDirectFillSandwich(frontRun, victimTrade, backRun, options) {
  const roundTrip = directFillRoundTrip(frontRun, victimTrade, backRun, options);
  if (!roundTrip || roundTrip.edgeBps < options.minProfitBps) return null;

  const reasons = [
    "same attacker taker entered before the victim and exited after",
    "victim transaction directly filled part of the attacker exit",
    "victim execution rate moved against the victim after the attacker entry",
    "attacker exit volume meaningfully closes the front-run position",
    `estimated closed-position edge ${roundTrip.edgeBps.toFixed(2)} bps`
  ];
  let confidence = 0.62 + Math.min(0.18, roundTrip.edgeBps / 300);

  if (frontRun.ledgerIndex === victimTrade.ledgerIndex && victimTrade.ledgerIndex === backRun.ledgerIndex) {
    confidence += 0.12;
    reasons.push("all three transactions landed in the same ledger");
  }

  if (roundTrip.directExit.volumeBase >= frontRun.volumeBase * 0.1) {
    confidence += 0.04;
    reasons.push("victim filled a material part of the attacker exit");
  }

  return {
    type: "probable_direct_fill_sandwich",
    confidence: Number(Math.min(confidence, 0.98).toFixed(3)),
    reasons,
    pair: frontRun.pair,
    attacker: frontRun.taker,
    victim: victimTrade.taker,
    entryRate: frontRun.rate,
    victimRate: victimTrade.rate,
    exitRate: roundTrip.exitRate,
    estimatedProfitBps: Number(roundTrip.edgeBps.toFixed(4)),
    closedBaseVolume: Number(roundTrip.closedBaseVolume.toFixed(6)),
    ledgerSpan: backRun.ledgerIndex - frontRun.ledgerIndex,
    frontRun,
    victimTrade,
    directExitTrade: roundTrip.directExit,
    backRun
  };
}

function normalizeRestExchange(exchange, pair, syntheticTxIndex = 0) {
  if (!exchange?.tx_hash || exchange.ledger_index === undefined) return null;
  return {
    txHash: String(exchange.tx_hash),
    pair,
    rate: toNumber(exchange.rate),
    volumeBase: toNumber(exchange.base_amount),
    volumeQuote: toNumber(exchange.counter_amount),
    buyer: exchange.buyer ? String(exchange.buyer) : "",
    seller: exchange.seller ? String(exchange.seller) : "",
    taker: exchange.taker ? String(exchange.taker) : "",
    provider: exchange.provider ? String(exchange.provider) : "",
    isAmm: Boolean(exchange.provider_is_amm),
    ledgerIndex: toNumber(exchange.ledger_index),
    txIndex: exchange.tx_index === undefined ? syntheticTxIndex : toNumber(exchange.tx_index),
    ledgerCloseTimeUtc: exchange.executed_time ? String(exchange.executed_time) : ""
  };
}

function classifyTrade(trade) {
  let side = "unknown";
  if (trade.taker && trade.taker === trade.buyer) side = "buy_base";
  if (trade.taker && trade.taker === trade.seller) side = "sell_base";
  return { ...trade, side };
}

function aggregateTradesByTransaction(trades) {
  const groups = new Map();

  for (const trade of trades) {
    const classified = classifyTrade(trade);
    const key = [
      classified.txHash,
      classified.pair,
      classified.taker,
      classified.side,
      classified.ledgerIndex,
      classified.txIndex
    ].join("|");
    const fill = {
      ...classified,
      volumeQuote: quoteVolume(classified)
    };
    const aggregateQuoteVolume = fill.volumeQuote;
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        ...trade,
        volumeQuote: aggregateQuoteVolume,
        participantAccounts: tradeParticipantAccounts(classified),
        fills: [fill],
        fillCount: 1
      });
      continue;
    }

    existing.volumeBase += classified.volumeBase;
    existing.volumeQuote += aggregateQuoteVolume;
    existing.rate = existing.volumeBase > 0 ? existing.volumeQuote / existing.volumeBase : existing.rate;
    existing.participantAccounts = uniqueAccounts([
      ...(existing.participantAccounts || []),
      ...tradeParticipantAccounts(classified)
    ]);
    existing.fills.push(fill);
    existing.fillCount += 1;
    if (existing.buyer !== classified.buyer) existing.buyer = "multiple";
    if (existing.seller !== classified.seller) existing.seller = "multiple";
    if (existing.provider !== classified.provider) existing.provider = "multiple";
  }

  return [...groups.values()];
}

function tradeIncludesAccount(trade, account) {
  if (!account) return false;
  return tradeParticipantAccounts(trade).includes(account);
}

function tradeParticipantAccounts(trade) {
  return uniqueAccounts([
    ...(Array.isArray(trade.participantAccounts) ? trade.participantAccounts : []),
    trade.taker,
    trade.buyer,
    trade.seller,
    trade.provider
  ]);
}

function uniqueAccounts(accounts) {
  return [...new Set(accounts.filter(Boolean).filter((account) => account !== "multiple"))];
}

function summarizeAlert(alert) {
  return {
    type: alert.type,
    confidence: alert.confidence,
    pair: alert.pair,
    attacker: alert.attacker,
    victim: alert.victim,
    estimatedProfitBps: alert.estimatedProfitBps,
    closedBaseVolume: alert.closedBaseVolume,
    ledgerSpan: alert.ledgerSpan,
    frontRun: compactTrade(alert.frontRun),
    victimTrade: compactTrade(alert.victimTrade),
    directExitTrade: alert.directExitTrade ? compactTrade(alert.directExitTrade) : undefined,
    backRun: compactTrade(alert.backRun),
    reasons: alert.reasons
  };
}

function compactTrade(trade) {
  return {
    txHash: trade.txHash,
    side: trade.side,
    rate: trade.rate,
    volumeBase: trade.volumeBase,
    volumeQuote: trade.volumeQuote,
    taker: trade.taker,
    fillCount: trade.fillCount,
    ledgerIndex: trade.ledgerIndex,
    txIndex: trade.txIndex
  };
}

function enrichAlertSummary(alert) {
  return {
    ...alert,
    impact: roundedImpact(estimateXrpImpact(alert)),
    source: "XRPLData exchanges"
  };
}

function estimateXrpImpact(alert) {
  let attackerProfitXrp = closedRoundTripProfitXrp(alert);

  const frontFee = Number(alert.frontRun.feeDrops || 0) / 1_000_000;
  const backFee = Number(alert.backRun.feeDrops || 0) / 1_000_000;
  if (attackerProfitXrp !== null && (frontFee || backFee)) {
    attackerProfitXrp -= frontFee + backFee;
  }

  return {
    attackerProfitXrp,
    victimLossXrp: estimateVictimLoss(alert, attackerProfitXrp),
    method: impactMethod(alert.pair)
  };
}

function closedRoundTripProfitXrp(alert) {
  if (alert.directExitTrade) return directFillProfitXrp(alert);

  const { base, counter } = splitPair(alert.pair);
  const closedBaseVolume = Math.min(alert.frontRun.volumeBase, alert.backRun.volumeBase);

  if (counter === "XRP") {
    if (alert.frontRun.side === "buy_base" && alert.backRun.side === "sell_base") {
      return closedBaseVolume * (alert.backRun.rate - alert.frontRun.rate);
    }
    if (alert.frontRun.side === "sell_base" && alert.backRun.side === "buy_base") {
      return closedBaseVolume * (alert.frontRun.rate - alert.backRun.rate);
    }
  }

  if (base === "XRP") {
    return null;
  }

  return null;
}

function directFillRoundTrip(frontRun, victimTrade, backRun, options) {
  const directExit = attackerExitFromVictimTrade(frontRun, victimTrade);
  if (!directExit || directExit.volumeBase <= 0 || backRun.volumeBase <= 0) return null;

  const totalExitBase = directExit.volumeBase + backRun.volumeBase;
  const closedBaseVolume = Math.min(frontRun.volumeBase, totalExitBase);
  const largestLegVolume = Math.max(frontRun.volumeBase, totalExitBase);
  if (closedBaseVolume / largestLegVolume < options.minRoundTripVolumeRatio) return null;

  const frontQuoteUsed = proratedQuote(frontRun, closedBaseVolume);
  const directBaseUsed = Math.min(directExit.volumeBase, closedBaseVolume);
  const directQuoteUsed = proratedQuote(directExit, directBaseUsed);
  const remainingBase = Math.max(0, closedBaseVolume - directBaseUsed);
  const backQuoteUsed = proratedQuote(backRun, remainingBase);
  const exitQuoteUsed = directQuoteUsed + backQuoteUsed;
  if (frontQuoteUsed <= 0 || exitQuoteUsed <= 0) return null;

  const profitQuote = frontRun.side === "buy_base"
    ? exitQuoteUsed - frontQuoteUsed
    : frontQuoteUsed - exitQuoteUsed;
  const edgeBps = (profitQuote / frontQuoteUsed) * 10_000;
  const exitRate = exitQuoteUsed / closedBaseVolume;

  return {
    closedBaseVolume,
    edgeBps,
    directExit: {
      ...directExit,
      rate: directExit.volumeBase > 0 ? directExit.volumeQuote / directExit.volumeBase : 0
    },
    exitRate
  };
}

function directFillProfitXrp(alert) {
  const { counter } = splitPair(alert.pair);
  if (counter !== "XRP") return null;

  const closedBaseVolume = Math.min(
    alert.frontRun.volumeBase,
    alert.directExitTrade.volumeBase + alert.backRun.volumeBase
  );
  const frontQuoteUsed = proratedQuote(alert.frontRun, closedBaseVolume);
  const directBaseUsed = Math.min(alert.directExitTrade.volumeBase, closedBaseVolume);
  const directQuoteUsed = proratedQuote(alert.directExitTrade, directBaseUsed);
  const remainingBase = Math.max(0, closedBaseVolume - directBaseUsed);
  const backQuoteUsed = proratedQuote(alert.backRun, remainingBase);

  if (alert.frontRun.side === "buy_base") {
    return directQuoteUsed + backQuoteUsed - frontQuoteUsed;
  }
  if (alert.frontRun.side === "sell_base") {
    return frontQuoteUsed - directQuoteUsed - backQuoteUsed;
  }
  return null;
}

function attackerExitFromVictimTrade(frontRun, victimTrade) {
  const fills = Array.isArray(victimTrade.fills) ? victimTrade.fills : [victimTrade];
  const attacker = frontRun.taker;
  const exitFills = fills.filter((fill) => {
    if (frontRun.side === "buy_base") {
      return fill.seller === attacker || fill.provider === attacker;
    }
    if (frontRun.side === "sell_base") {
      return fill.buyer === attacker || fill.provider === attacker;
    }
    return false;
  });

  if (!exitFills.length) return null;

  const volumeBase = exitFills.reduce((total, fill) => total + fill.volumeBase, 0);
  const volumeQuote = exitFills.reduce((total, fill) => total + quoteVolume(fill), 0);
  return {
    txHash: victimTrade.txHash,
    pair: victimTrade.pair,
    side: oppositeSide(frontRun.side),
    rate: volumeBase > 0 ? volumeQuote / volumeBase : 0,
    volumeBase,
    volumeQuote,
    taker: frontRun.taker,
    ledgerIndex: victimTrade.ledgerIndex,
    txIndex: victimTrade.txIndex,
    fillCount: exitFills.length
  };
}

function proratedQuote(trade, baseVolume) {
  if (baseVolume <= 0 || trade.volumeBase <= 0) return 0;
  return quoteVolume(trade) * Math.min(1, baseVolume / trade.volumeBase);
}

function quoteVolume(trade) {
  return trade.volumeQuote || trade.volumeBase * trade.rate;
}

function oppositeSide(side) {
  if (side === "buy_base") return "sell_base";
  if (side === "sell_base") return "buy_base";
  return "unknown";
}

function estimateVictimLoss(alert) {
  const { base, counter } = splitPair(alert.pair);
  if (counter === "XRP") {
    if (alert.victimTrade.side === "buy_base") {
      return Math.max(0, (alert.victimTrade.rate - alert.frontRun.rate) * alert.victimTrade.volumeBase);
    }
    if (alert.victimTrade.side === "sell_base") {
      return Math.max(0, (alert.frontRun.rate - alert.victimTrade.rate) * alert.victimTrade.volumeBase);
    }
  }
  if (base === "XRP") return null;
  return null;
}

function roundedImpact(impact) {
  return {
    ...impact,
    attackerProfitXrp:
      impact.attackerProfitXrp === null ? null : Number(impact.attackerProfitXrp.toFixed(6)),
    victimLossXrp: impact.victimLossXrp === null ? null : Number(impact.victimLossXrp.toFixed(6))
  };
}

function renderMetrics(totals = {}) {
  document.querySelector("#metric-alerts").textContent = fmt.format(totals.alerts || 0);
  document.querySelector("#metric-same-ledger").textContent = fmt.format(totals.sameLedgerAlerts || 0);
  document.querySelector("#metric-xrp-pairs").textContent = fmt.format(totals.xrpPairAlerts || 0);
  document.querySelector("#metric-profit").textContent = fmt.format(totals.totalAttackerProfitXrp || 0);
  document.querySelector("#metric-loss").textContent = fmt.format(totals.totalVictimLossXrp || 0);
}

function renderRange(range = {}) {
  const label = range.startLedger
    ? `${range.startLedger} to ${range.endLedger} · ${range.startCloseTime} to ${range.endCloseTime}`
    : "No scan yet";
  document.querySelector("#range-label").textContent = label;
}

function renderAlerts() {
  if (!state.alerts.length) {
    renderEmpty("No candidates found for this range.");
    renderDetails(null);
    pager.hidden = true;
    return;
  }

  const pages = pageCount();
  state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * state.pageSize;
  const pageAlerts = state.alerts.slice(start, start + state.pageSize);

  alertsBody.innerHTML = pageAlerts
    .map((alert, offset) => {
      const index = start + offset;
      const signal = alertSignalLabel(alert);
      const signalClass = alert.ledgerSpan === 0 ? "" : "warn";
      return `<tr data-index="${index}">
        <td>${Math.round(alert.confidence * 100)}%</td>
        <td class="mono">${escapeHtml(shortPair(alert.pair))}</td>
        <td class="mono">${escapeHtml(shortAddress(alert.victim))}</td>
        <td class="mono">${escapeHtml(shortAddress(alert.attacker))}</td>
        <td>${formatNullable(alert.impact.attackerProfitXrp)}</td>
        <td>${formatNullable(alert.impact.victimLossXrp)}</td>
        <td>${alert.frontRun.ledgerIndex}</td>
        <td><span class="pill ${signalClass}">${signal}</span></td>
      </tr>`;
    })
    .join("");

  alertsBody.querySelectorAll("tr[data-index]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedIndex = Number(row.dataset.index);
      renderAlerts();
      renderDetails(state.alerts[state.selectedIndex]);
    });
    if (Number(row.dataset.index) === state.selectedIndex) row.classList.add("selected");
  });

  pager.hidden = pages <= 1;
  pageLabel.textContent = `Page ${state.page} of ${pages}`;
  prevPage.disabled = state.page <= 1;
  nextPage.disabled = state.page >= pages;

  if (state.selectedIndex === null) {
    state.selectedIndex = start;
    renderDetails(state.alerts[start]);
  }
}

function renderDetails(alert) {
  if (!alert) {
    details.innerHTML = `<div class="section-head"><h2>Alert Details</h2></div><p class="empty-detail">Select a candidate to inspect the transaction path.</p>`;
    return;
  }

  details.innerHTML = `<div class="section-head"><h2>Alert Details</h2><span>${Math.round(alert.confidence * 100)}% confidence</span></div>
    <div class="detail-body">
      <dl>
        <dt>Pair</dt><dd class="mono">${escapeHtml(alert.pair)}</dd>
        <dt>Attacker</dt><dd class="mono">${escapeHtml(alert.attacker)}</dd>
        <dt>Victim</dt><dd class="mono">${escapeHtml(alert.victim)}</dd>
        <dt>Profit XRP</dt><dd>${formatNullable(alert.impact.attackerProfitXrp)}</dd>
        <dt>Victim Loss</dt><dd>${formatNullable(alert.impact.victimLossXrp)}</dd>
        <dt>Edge</dt><dd>${fmt.format(alert.estimatedProfitBps)} bps</dd>
        <dt>Signal</dt><dd>${escapeHtml(alertSignalLabel(alert))}</dd>
        <dt>Source</dt><dd>XRPLData exchanges</dd>
      </dl>
      ${txCard("Front-run", alert.frontRun)}
      ${txCard("Victim", alert.victimTrade)}
      ${alert.directExitTrade ? txCard("Victim-filled exit", alert.directExitTrade) : ""}
      ${txCard("Back-run", alert.backRun)}
    </div>`;
}

function alertSignalLabel(alert) {
  if (alert.type === "probable_direct_fill_sandwich") return "direct-fill sandwich";
  return alert.ledgerSpan === 0 ? "same ledger" : "near ledger";
}

function txCard(title, tx) {
  return `<div class="tx-card">
    <h3>${title}</h3>
    <p class="mono">${escapeHtml(tx.txHash)}</p>
    <p>${escapeHtml(tx.side || "unknown")} · ledger ${tx.ledgerIndex} · tx index ${tx.txIndex ?? "?"}</p>
    <p>Rate ${fmt.format(tx.rate)} · base volume ${fmt.format(tx.volumeBase)}</p>
    <p>Taker ${escapeHtml(shortAddress(tx.taker))}</p>
  </div>`;
}

function renderEmpty(message) {
  alertsBody.innerHTML = `<tr><td colspan="8" class="empty">${escapeHtml(message)}</td></tr>`;
}

function createProgress() {
  return { percent: 0 };
}

function updateProgress(progress, percent, label, detail) {
  progress.percent = Math.max(progress.percent, Math.min(100, Math.round(percent)));
  progressLabel.textContent = label;
  progressPercent.textContent = `${progress.percent}%`;
  progressBar.style.width = `${progress.percent}%`;
  updateProgressDetail(detail);
}

function updateProgressDetail(detail) {
  progressDetail.textContent = detail;
}

function renderRateLimit() {
  const { limit, remaining, resetAt, estimated } = state.rateLimit;
  if (!limit) {
    rateLimitEl.textContent = "Rate limit: calibrating…";
    return;
  }

  ensureRateLimitCountdown();

  const prefix = estimated ? "~" : "";
  const resetSeconds = resetSecondsRemaining(resetAt);
  const resetLabel =
    resetSeconds !== null && resetSeconds > 0 ? ` · reset ${resetSeconds}s` : "";
  rateLimitEl.textContent = `Rate limit: ${prefix}${remaining}/${limit}${estimated ? " est." : ""}${resetLabel}`;
}

function summarizeTotals(alerts) {
  const countedRoundTrips = new Set();
  let totalAttackerProfitXrp = 0;
  for (const alert of alerts) {
    const roundTripKey = `${alert.frontRun.txHash}:${alert.backRun.txHash}`;
    if (countedRoundTrips.has(roundTripKey)) continue;
    countedRoundTrips.add(roundTripKey);
    totalAttackerProfitXrp += Math.max(0, alert.impact.attackerProfitXrp ?? 0);
  }

  const totalVictimLossXrp = alerts.reduce(
    (total, alert) => total + Math.max(0, alert.impact.victimLossXrp ?? 0),
    0
  );
  return {
    alerts: alerts.length,
    sameLedgerAlerts: alerts.filter((alert) => alert.ledgerSpan === 0).length,
    xrpPairAlerts: alerts.filter((alert) => alert.impact.attackerProfitXrp !== null).length,
    totalAttackerProfitXrp: Number(totalAttackerProfitXrp.toFixed(6)),
    totalVictimLossXrp: Number(totalVictimLossXrp.toFixed(6))
  };
}

function formPayload() {
  return {
    startTime: document.querySelector("#start-time").value,
    endTime: document.querySelector("#end-time").value,
    startLedger: optionalNumberValue("#start-ledger"),
    endLedger: optionalNumberValue("#end-ledger"),
    pairs: numberValue("#pairs"),
    minExchanges: numberValue("#min-exchanges"),
    minProfitBps: numberValue("#min-profit-bps"),
    excludeAmm: !document.querySelector("#include-amm").checked,
    maxLedgerGap: 1,
    maxTxGap: 60,
    maxCrossLedgerTxGap: 60,
    minVictimVolumeRatio: 0.15,
    minRoundTripVolumeRatio: 0.5
  };
}

async function resolveScanRange(options, gate) {
  if ((options.startLedger && !options.endLedger) || (!options.startLedger && options.endLedger)) {
    throw new Error("Fill both ledger override fields, or leave both blank.");
  }
  if (options.startLedger && options.endLedger) {
    if (options.endLedger < options.startLedger) throw new Error("End ledger must be greater than start ledger.");
    const [startClose, endClose] = await Promise.all([
      xrplDataJson(`/ledgers/ledger_close_time?ledger_index=${options.startLedger}`, {}, gate),
      xrplDataJson(`/ledgers/ledger_close_time?ledger_index=${options.endLedger}`, {}, gate)
    ]);
    return {
      startLedger: options.startLedger,
      endLedger: options.endLedger,
      start: startClose.closed,
      end: endClose.closed
    };
  }

  if (!options.startTime || !options.endTime) throw new Error("Choose a start and end time.");
  const start = localDateTimeToIso(options.startTime);
  const end = localDateTimeToIso(options.endTime);
  if (Date.parse(end) <= Date.parse(start)) throw new Error("End time must be after start time.");

  const [startLedger, endLedger] = await Promise.all([
    xrplDataJson(`/ledgers/ledger_index?date=${encodeURIComponent(start)}`, {}, gate),
    xrplDataJson(`/ledgers/ledger_index?date=${encodeURIComponent(end)}`, {}, gate)
  ]);

  return {
    startLedger: Number(startLedger.ledger_index),
    endLedger: Number(endLedger.ledger_index),
    start,
    end
  };
}

function setQuickRange(days) {
  const end = state.latestCloseTime ? new Date(state.latestCloseTime) : new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  document.querySelector("#start-time").value = toDateTimeLocal(start);
  document.querySelector("#end-time").value = toDateTimeLocal(end);
  document.querySelector("#start-ledger").value = "";
  document.querySelector("#end-ledger").value = "";
}

async function mapLimit(items, concurrency, task) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function sortAlerts(a, b) {
  const bProfit = b.impact.attackerProfitXrp ?? -Infinity;
  const aProfit = a.impact.attackerProfitXrp ?? -Infinity;
  if (bProfit !== aProfit) return bProfit - aProfit;
  return b.confidence - a.confidence;
}

function estimateProfitBps(frontRun, backRun) {
  if (frontRun.rate <= 0 || backRun.rate <= 0) return 0;
  if (frontRun.side === "buy_base" && backRun.side === "sell_base") {
    return ((backRun.rate - frontRun.rate) / frontRun.rate) * 10_000;
  }
  if (frontRun.side === "sell_base" && backRun.side === "buy_base") {
    return ((frontRun.rate - backRun.rate) / frontRun.rate) * 10_000;
  }
  return 0;
}

function victimRateMovedAgainstTrade(frontRun, victimTrade, options) {
  if (frontRun.rate <= 0 || victimTrade.rate <= 0) return false;
  const minMove = 1 + (options.minVictimRateMoveBps || 0) / 10_000;
  const maxMove = 1 - (options.minVictimRateMoveBps || 0) / 10_000;

  if (frontRun.side === "buy_base") return victimTrade.rate > frontRun.rate * minMove;
  if (frontRun.side === "sell_base") return victimTrade.rate < frontRun.rate * maxMove;
  return false;
}

function closedRoundTripBaseVolume(frontRun, backRun, options) {
  if (frontRun.volumeBase <= 0 || backRun.volumeBase <= 0) return null;
  const closedBaseVolume = Math.min(frontRun.volumeBase, backRun.volumeBase);
  const largestLegVolume = Math.max(frontRun.volumeBase, backRun.volumeBase);
  const overlapRatio = closedBaseVolume / largestLegVolume;
  return overlapRatio >= options.minRoundTripVolumeRatio ? closedBaseVolume : null;
}

function isCloseEnough(a, b, options) {
  const ledgerGap = Math.abs(b.ledgerIndex - a.ledgerIndex);
  if (ledgerGap > options.maxLedgerGap) return false;
  if (ledgerGap === 0 && Math.abs(b.txIndex - a.txIndex) > options.maxTxGap) return false;
  if (ledgerGap > 0 && b.txIndex > options.maxCrossLedgerTxGap) return false;
  return compareTrades(a, b) < 0;
}

function isBetween(before, middle, after) {
  return compareTrades(before, middle) < 0 && compareTrades(middle, after) < 0;
}

function compareTrades(a, b) {
  if (a.ledgerIndex !== b.ledgerIndex) return a.ledgerIndex - b.ledgerIndex;
  if (a.txIndex !== undefined && b.txIndex !== undefined && a.txIndex !== b.txIndex) {
    return a.txIndex - b.txIndex;
  }
  return a.txHash.localeCompare(b.txHash);
}

function splitPair(pair) {
  const [base, counter] = String(pair).split("|");
  return { base, counter };
}

function impactMethod(pair) {
  const { base, counter } = splitPair(pair);
  if (counter === "XRP") return "direct_xrp_counter";
  if (base === "XRP") return "direct_xrp_base";
  return "non_xrp_pair";
}

function pageCount() {
  return Math.max(1, Math.ceil(state.alerts.length / state.pageSize));
}

function numberValue(selector) {
  return Number(document.querySelector(selector).value);
}

function optionalNumberValue(selector) {
  const value = document.querySelector(selector).value.trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNullable(value) {
  return value === null || value === undefined ? "n/a" : fmt.format(value);
}

function localDateTimeToIso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date/time.");
  return date.toISOString();
}

function toDateTimeLocal(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function shortAddress(value) {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "";
}

function shortPair(pair) {
  const [base, counter] = pair.split("|");
  return `${shortToken(base)} / ${shortToken(counter)}`;
}

function shortToken(token) {
  if (token === "XRP") return "XRP";
  const [issuer, currency] = token.split("_");
  return `${decodeCurrency(currency) || token.slice(0, 8)}@${issuer.slice(0, 5)}`;
}

function decodeCurrency(currency) {
  if (!currency) return "";
  if (/^[0-9A-Fa-f]{40}$/.test(currency)) {
    let text = "";
    for (let i = 0; i < currency.length; i += 2) {
      const code = Number.parseInt(currency.slice(i, i + 2), 16);
      if (code > 0) text += String.fromCharCode(code);
    }
    return text || currency.slice(0, 8);
  }
  return currency;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

boot();
