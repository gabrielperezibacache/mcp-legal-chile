import test from "node:test";
import assert from "node:assert/strict";
import {
  warmupCount,
  warmupDelayMs,
  warmupSlice,
} from "../dist/warmup.js";
import { HOT_IDS_FOR_WARMUP } from "../dist/catalog.js";
import { metrics } from "../dist/metrics.js";

test("warmupSlice rota por el catálogo HOT", () => {
  const a = warmupSlice(HOT_IDS_FOR_WARMUP, 3, 0);
  assert.equal(a.ids.length, 3);
  assert.equal(a.offset, 0);
  assert.deepEqual(a.ids, HOT_IDS_FOR_WARMUP.slice(0, 3));

  const b = warmupSlice(HOT_IDS_FOR_WARMUP, 3, 30 * 60_000);
  // default rotate 30 min → offset 1
  assert.equal(b.offset, 1);
  assert.equal(b.ids[0], HOT_IDS_FOR_WARMUP[1]);
});

test("warmupSlice con WARMUP_OFFSET fijo", () => {
  const prev = process.env.WARMUP_OFFSET;
  process.env.WARMUP_OFFSET = "5";
  try {
    const s = warmupSlice(HOT_IDS_FOR_WARMUP, 2, 0);
    assert.equal(s.offset, 5);
    assert.equal(s.ids[0], HOT_IDS_FOR_WARMUP[5]);
  } finally {
    if (prev === undefined) delete process.env.WARMUP_OFFSET;
    else process.env.WARMUP_OFFSET = prev;
  }
});

test("warmupCount y delay respetan topes", () => {
  const prevC = process.env.WARMUP_COUNT;
  const prevD = process.env.WARMUP_DELAY_MS;
  process.env.WARMUP_COUNT = "99";
  process.env.WARMUP_DELAY_MS = "99999";
  try {
    assert.equal(warmupCount("boot"), 6);
    assert.equal(warmupCount("cron"), 8);
    assert.equal(warmupDelayMs(), 15_000);
  } finally {
    if (prevC === undefined) delete process.env.WARMUP_COUNT;
    else process.env.WARMUP_COUNT = prevC;
    if (prevD === undefined) delete process.env.WARMUP_DELAY_MS;
    else process.env.WARMUP_DELAY_MS = prevD;
  }
});

test("metrics.snapshot incluye sloStatus", () => {
  const snap = metrics.snapshot("1.19.0");
  assert.equal(typeof snap.sloStatus.ok, "boolean");
  assert.ok(Array.isArray(snap.sloStatus.warnings));
});
