import test from "node:test";
import assert from "node:assert/strict";
import { chooseTickerInterval, QUICK_RANGE_PRESETS } from "../src/ticker-interval.js";

const END = "2026-06-29T14:39:00.000Z";

function startDaysBefore(days) {
  const end = Date.parse(END);
  return new Date(end - days * 86_400_000).toISOString();
}

test("quick range presets map to valid API intervals", () => {
  const expected = {
    1: "24h",
    7: "7d",
    30: "30d",
    90: "13w"
  };

  for (const preset of QUICK_RANGE_PRESETS) {
    const start = startDaysBefore(preset.days);
    const interval = chooseTickerInterval(start, END);
    assert.equal(interval, expected[preset.days], preset.label);
    assert.doesNotMatch(interval, /^(3[2-9]|[4-9]\d|\d{3,})d$/);
  }
});

test("chooseTickerInterval respects API unit boundaries", () => {
  assert.equal(chooseTickerInterval(startDaysBefore(1), END), "24h");
  assert.equal(chooseTickerInterval(startDaysBefore(7), END), "7d");
  assert.equal(chooseTickerInterval(startDaysBefore(30), END), "30d");
  assert.equal(chooseTickerInterval(startDaysBefore(31), END), "31d");
  assert.equal(chooseTickerInterval(startDaysBefore(32), END), "5w");
  assert.equal(chooseTickerInterval(startDaysBefore(60), END), "9w");
  assert.equal(chooseTickerInterval(startDaysBefore(365), END), "1y");
});
