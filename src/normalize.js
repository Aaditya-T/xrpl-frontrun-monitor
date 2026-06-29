export function normalizeStreamTrade(message) {
  if (!message || typeof message !== "object") return null;
  if (!message.tx_hash || !message.pair || message.ledger_index === undefined) return null;

  return normalizeTrade({
    txHash: message.tx_hash,
    pair: message.pair,
    rate: message.rate,
    volumeBase: message.volume_base,
    volumeQuote: message.volume_quote,
    buyer: message.buyer,
    seller: message.seller,
    taker: message.taker,
    provider: message.provider,
    isAmm: Boolean(message.isAMM),
    ledgerIndex: message.ledger_index,
    txIndex: message.tx_index ?? 0,
    ledgerCloseTimeUtc: message.ledger_close_time_utc,
    txType: message.tx_type,
    offerSequence: message.offer_sequence ?? undefined
  });
}

export function normalizeRestExchange(exchange, pair, syntheticTxIndex = 0) {
  if (!exchange || typeof exchange !== "object") return null;
  if (!exchange.tx_hash || exchange.ledger_index === undefined) return null;

  return normalizeTrade({
    txHash: exchange.tx_hash,
    pair,
    rate: exchange.rate,
    volumeBase: exchange.base_amount,
    volumeQuote: exchange.counter_amount,
    buyer: exchange.buyer,
    seller: exchange.seller,
    taker: exchange.taker,
    provider: exchange.provider,
    isAmm: Boolean(exchange.provider_is_amm),
    ledgerIndex: exchange.ledger_index,
    txIndex: exchange.tx_index ?? syntheticTxIndex,
    ledgerCloseTimeUtc: exchange.executed_time
  });
}

export function normalizeTrade(raw) {
  return {
    txHash: String(raw.txHash),
    pair: String(raw.pair),
    rate: toNumber(raw.rate),
    volumeBase: toNumber(raw.volumeBase),
    volumeQuote: toNumber(raw.volumeQuote),
    buyer: raw.buyer ? String(raw.buyer) : "",
    seller: raw.seller ? String(raw.seller) : "",
    taker: raw.taker ? String(raw.taker) : "",
    provider: raw.provider ? String(raw.provider) : "",
    isAmm: Boolean(raw.isAmm),
    ledgerIndex: toNumber(raw.ledgerIndex),
    txIndex: toNumber(raw.txIndex),
    ledgerCloseTimeUtc: raw.ledgerCloseTimeUtc ? String(raw.ledgerCloseTimeUtc) : "",
    txType: raw.txType ? String(raw.txType) : undefined,
    offerSequence: raw.offerSequence === undefined ? undefined : toNumber(raw.offerSequence),
    sequence: raw.sequence === undefined ? undefined : toNumber(raw.sequence),
    ticketSequence: raw.ticketSequence === undefined ? undefined : toNumber(raw.ticketSequence)
  };
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
