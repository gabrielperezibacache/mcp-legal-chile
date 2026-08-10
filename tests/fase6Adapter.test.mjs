import test from "node:test";
import assert from "node:assert/strict";
import {
  getAdminAdapter,
  listAdminAdapters,
} from "../dist/sources/adapter.js";
import {
  resolvePackBudget,
} from "../dist/sources/research.js";

test("SourceAdapter registry incluye dt/cgr/sernac/cmf", () => {
  const ids = new Set(listAdminAdapters().map((a) => a.id));
  assert.deepEqual([...ids].sort(), ["cgr", "cmf", "dt", "sernac"].sort());
  const dt = getAdminAdapter("dt");
  assert.equal(dt.kind, "dictamenes");
  assert.equal(typeof dt.search, "function");
  assert.match(dt.label, /Trabajo/i);
});

test("resolvePackBudget fast/default/deep", () => {
  const fast = resolvePackBudget("fast");
  assert.equal(fast.profile, "fast");
  assert.ok(fast.totalMs <= 10_000);
  assert.equal(fast.doctrinaFast, true);

  const deep = resolvePackBudget("deep");
  assert.equal(deep.profile, "deep");
  assert.ok(deep.totalMs >= 20_000);
  assert.equal(deep.doctrinaFast, false);

  const def = resolvePackBudget("default");
  assert.equal(def.profile, "default");
  assert.equal(def.totalMs, 18_000);
});
