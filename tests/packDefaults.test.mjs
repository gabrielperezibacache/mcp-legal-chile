import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("research.ts defaults PACK_TOTAL_MS=18000 y PACK_TIMEOUT ~11s", () => {
  const src = readFileSync(join(root, "src/sources/research.ts"), "utf8");
  assert.match(src, /PACK_TOTAL_MS \?\? 18_000/);
  assert.match(src, /Math\.min\(11_000,\s*Math\.floor\(totalMs \* 0\.65\)\)/);
});

test(".env.example documenta pack 18s / 11s", () => {
  const env = readFileSync(join(root, ".env.example"), "utf8");
  assert.match(env, /PACK_TOTAL_MS=18000/);
  assert.match(env, /PACK_TIMEOUT_MS=11000/);
});
