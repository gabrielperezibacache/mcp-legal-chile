import test from "node:test";
import assert from "node:assert/strict";
import { TtlCache } from "../dist/cache.js";

test("TtlCache.getOrSet singleflight: una sola factory concurrente", async () => {
  const cache = new TtlCache(60_000);
  let runs = 0;
  const factory = async () => {
    runs += 1;
    await new Promise((r) => setTimeout(r, 40));
    return { n: runs };
  };
  const [a, b, c] = await Promise.all([
    cache.getOrSet("sf:1", factory),
    cache.getOrSet("sf:1", factory),
    cache.getOrSet("sf:1", factory),
  ]);
  assert.equal(runs, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});
