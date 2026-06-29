export class XrplTxEnricher {
  constructor({ rpcUrl, enabled = true }) {
    this.rpcUrl = rpcUrl;
    this.enabled = enabled;
    this.cache = new Map();
  }

  async enrich(trade) {
    if (!this.enabled || !this.rpcUrl || !trade.txHash) return trade;
    if (this.cache.has(trade.txHash)) return { ...trade, ...this.cache.get(trade.txHash) };

    const result = await this.fetchTx(trade.txHash);
    const details = extractTxDetails(result);
    this.cache.set(trade.txHash, details);
    return { ...trade, ...details };
  }

  async fetchTx(hash) {
    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: "tx",
        params: [
          {
            transaction: hash,
            binary: false
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`XRPL tx lookup ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json();
    if (payload.error) throw new Error(`XRPL tx lookup error: ${payload.error}`);
    return payload.result;
  }
}

export function extractTxDetails(result) {
  const tx = result?.tx_json || result?.tx || result;
  const meta = result?.meta || result?.metaData;
  return {
    txType: tx?.TransactionType,
    account: tx?.Account,
    sequence: tx?.Sequence,
    ticketSequence: tx?.TicketSequence,
    offerSequence: tx?.OfferSequence,
    ledgerIndex: result?.ledger_index || result?.inLedger,
    txIndex: meta?.TransactionIndex,
    txResult: meta?.TransactionResult,
    feeDrops: tx?.Fee
  };
}
