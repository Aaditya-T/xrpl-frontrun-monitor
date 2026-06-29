export function estimateXrpImpact(alert) {
  const frontCashflow = xrpCashflow(alert.pair, alert.frontRun);
  const backCashflow = xrpCashflow(alert.pair, alert.backRun);
  const attackerProfitXrp =
    frontCashflow === null || backCashflow === null ? null : frontCashflow + backCashflow;

  return {
    attackerProfitXrp,
    victimLossXrp: estimateVictimLoss(alert, attackerProfitXrp),
    method: impactMethod(alert.pair)
  };
}

export function xrpCashflow(pair, trade) {
  const { base, counter } = splitPair(pair);

  if (counter === "XRP") {
    const xrpValue = trade.volumeBase * trade.rate;
    if (trade.side === "buy_base") return -xrpValue;
    if (trade.side === "sell_base") return xrpValue;
  }

  if (base === "XRP") {
    if (trade.side === "buy_base") return trade.volumeBase;
    if (trade.side === "sell_base") return -trade.volumeBase;
  }

  return null;
}

function estimateVictimLoss(alert, attackerProfitXrp) {
  const { base, counter } = splitPair(alert.pair);

  if (counter === "XRP") {
    if (alert.victimTrade.side === "buy_base") {
      return Math.max(0, (alert.victimTrade.rate - alert.frontRun.rate) * alert.victimTrade.volumeBase);
    }
    if (alert.victimTrade.side === "sell_base") {
      return Math.max(0, (alert.frontRun.rate - alert.victimTrade.rate) * alert.victimTrade.volumeBase);
    }
  }

  if (base === "XRP" && attackerProfitXrp !== null) {
    return Math.max(0, attackerProfitXrp);
  }

  return null;
}

function impactMethod(pair) {
  const { base, counter } = splitPair(pair);
  if (counter === "XRP") return "direct_xrp_counter";
  if (base === "XRP") return "direct_xrp_base";
  return "non_xrp_pair";
}

function splitPair(pair) {
  const [base, counter] = String(pair).split("|");
  return { base, counter };
}
