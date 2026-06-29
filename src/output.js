export function writeAlert(alert, writer = process.stdout) {
  writer.write(`${JSON.stringify(alert)}\n`);
}

export function summarizeAlert(alert) {
  return {
    type: alert.type,
    confidence: alert.confidence,
    pair: alert.pair,
    attacker: alert.attacker,
    victim: alert.victim,
    estimatedProfitBps: alert.estimatedProfitBps,
    ledgerSpan: alert.ledgerSpan,
    frontRun: compactTrade(alert.frontRun),
    victimTrade: compactTrade(alert.victimTrade),
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
    taker: trade.taker,
    ledgerIndex: trade.ledgerIndex,
    txIndex: trade.txIndex,
    sequence: trade.sequence,
    ticketSequence: trade.ticketSequence
  };
}
