import { normalizeRestExchange } from "./normalize.js";

export class XrplDataRestClient {
  constructor({ baseUrl }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async getExchanges({ base, counter, start, end, limit = 1000, skip = 0, onlyAmm, excludeAmm }) {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    if (limit) params.set("limit", String(limit));
    if (skip) params.set("skip", String(skip));
    if (onlyAmm !== undefined) params.set("only_amm", String(Boolean(onlyAmm)));
    if (excludeAmm !== undefined) params.set("exclude_amm", String(Boolean(excludeAmm)));

    const path = `/iou/exchanges/${encodeURIComponent(base)}/${encodeURIComponent(counter)}`;
    const response = await fetch(`${this.baseUrl}${path}?${params}`);
    if (!response.ok) {
      throw new Error(`XRPLData REST ${response.status}: ${await response.text()}`);
    }

    const pair = `${base}|${counter}`;
    const exchanges = await response.json();
    if (!Array.isArray(exchanges)) return [];
    return exchanges.map((exchange, index) => normalizeRestExchange(exchange, pair, index)).filter(Boolean);
  }

  async getTickerDataAll({ interval = "1h", minExchanges = 10, date, onlyAmm, excludeAmm } = {}) {
    const params = new URLSearchParams();
    params.set("interval", interval);
    if (minExchanges) params.set("min_exchanges", String(minExchanges));
    if (date) params.set("date", date);
    if (onlyAmm !== undefined) params.set("only_amm", String(Boolean(onlyAmm)));
    if (excludeAmm !== undefined) params.set("exclude_amm", String(Boolean(excludeAmm)));

    const response = await fetch(`${this.baseUrl}/iou/ticker_data/all?${params}`);
    if (!response.ok) {
      throw new Error(`XRPLData ticker REST ${response.status}: ${await response.text()}`);
    }

    const tickers = await response.json();
    return Array.isArray(tickers) ? tickers : [];
  }

  async getLedgerCloseTime(ledgerIndex) {
    const params = new URLSearchParams({ ledger_index: String(ledgerIndex) });
    const response = await fetch(`${this.baseUrl}/ledgers/ledger_close_time?${params}`);
    if (!response.ok) {
      throw new Error(`XRPLData ledger close time ${response.status}: ${await response.text()}`);
    }

    return response.json();
  }

  async getLatestLedgerIndex() {
    const response = await fetch(`${this.baseUrl}/ledgers/ledger_index`);
    if (!response.ok) {
      throw new Error(`XRPLData latest ledger ${response.status}: ${await response.text()}`);
    }

    return response.json();
  }
}
