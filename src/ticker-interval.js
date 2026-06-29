// XRPLData /iou/ticker_data interval query param.
// Docs: https://xrpldata.inftf.org/docs — format is <number><unit> where unit is s,m,h,d,w,M,y.
// Validated against the live API for non pair-specific ticker_data/all:
//   h: 1-24, d: 1-31, w: 1-51, M: 1-12, y: 1 only (52w+ falls back to 1y cap).

export const TICKER_INTERVAL_LIMITS = {
  h: { min: 1, max: 24 },
  d: { min: 1, max: 31 },
  w: { min: 1, max: 51 },
  M: { min: 1, max: 12 },
  y: { min: 1, max: 1 }
};

/** Scan-range presets shown as quick-select pills (days), not raw API interval strings. */
export const QUICK_RANGE_PRESETS = [
  { days: 1, label: "1d" },
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" }
];

export function chooseTickerInterval(startIso, endIso) {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("Invalid scan range.");
  }

  const spanMs = endMs - startMs;
  const hours = Math.max(1, Math.ceil(spanMs / 3_600_000));
  const days = Math.max(1, Math.ceil(spanMs / 86_400_000));
  const weeks = Math.max(1, Math.ceil(days / 7));
  const months = Math.max(1, Math.ceil(days / 30));

  if (hours <= TICKER_INTERVAL_LIMITS.h.max) return `${hours}h`;
  if (days <= TICKER_INTERVAL_LIMITS.d.max) return `${days}d`;
  if (weeks <= TICKER_INTERVAL_LIMITS.w.max) return `${weeks}w`;
  if (months <= TICKER_INTERVAL_LIMITS.M.max) return `${months}M`;
  return "1y";
}

export function tickerIntervalHint(startIso, endIso) {
  const interval = chooseTickerInterval(startIso, endIso);
  const days = Math.max(1, Math.ceil((Date.parse(endIso) - Date.parse(startIso)) / 86_400_000));
  if (interval === `${days}d`) return null;
  return `Pair activity window: ${interval}`;
}
