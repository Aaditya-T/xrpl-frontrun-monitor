import assert from "node:assert/strict";
import { test } from "node:test";
import { SandwichDetector } from "../src/detector.js";

test("detects buy-victim-sell sandwich in the same ledger", () => {
  const detector = new SandwichDetector({ minProfitBps: 1 });
  const trades = [
    trade({ txHash: "A", txIndex: 1, taker: "rAttacker", buyer: "rAttacker", seller: "rLP", rate: 1 }),
    trade({ txHash: "B", txIndex: 2, taker: "rVictim", buyer: "rVictim", seller: "rLP", rate: 1.02, volumeBase: 50 }),
    trade({ txHash: "C", txIndex: 3, taker: "rAttacker", buyer: "rLP", seller: "rAttacker", rate: 1.03 })
  ];

  let alerts = [];
  for (const item of trades) alerts = detector.ingest(item);

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].attacker, "rAttacker");
  assert.equal(alerts[0].victim, "rVictim");
  assert.equal(alerts[0].estimatedProfitBps, 300);
  assert.ok(alerts[0].confidence > 0.7);
});

test("detects sell-victim-buy inverse sandwich", () => {
  const detector = new SandwichDetector({ minProfitBps: 1 });
  const trades = [
    trade({ txHash: "A", txIndex: 1, taker: "rAttacker", buyer: "rLP", seller: "rAttacker", rate: 1.1 }),
    trade({ txHash: "B", txIndex: 2, taker: "rVictim", buyer: "rLP", seller: "rVictim", rate: 1.08, volumeBase: 50 }),
    trade({ txHash: "C", txIndex: 3, taker: "rAttacker", buyer: "rAttacker", seller: "rLP", rate: 1.05 })
  ];

  let alerts = [];
  for (const item of trades) alerts = detector.ingest(item);

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].estimatedProfitBps.toFixed(2), "454.55");
});

test("ignores unrelated opposite-side account activity", () => {
  const detector = new SandwichDetector({ minProfitBps: 1 });
  const trades = [
    trade({ txHash: "A", txIndex: 1, taker: "rOne", buyer: "rOne", seller: "rLP", rate: 1 }),
    trade({ txHash: "B", txIndex: 2, taker: "rVictim", buyer: "rVictim", seller: "rLP", rate: 1.02, volumeBase: 50 }),
    trade({ txHash: "C", txIndex: 3, taker: "rTwo", buyer: "rLP", seller: "rTwo", rate: 1.03 })
  ];

  let alerts = [];
  for (const item of trades) alerts = detector.ingest(item);

  assert.equal(alerts.length, 0);
});

function trade(overrides) {
  return {
    txHash: "HASH",
    pair: "XRP|rIssuer+USD",
    rate: 1,
    volumeBase: 10,
    volumeQuote: 10,
    buyer: "rBuyer",
    seller: "rSeller",
    taker: "rBuyer",
    provider: "rLP",
    isAmm: false,
    ledgerIndex: 100,
    txIndex: 0,
    ledgerCloseTimeUtc: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}
