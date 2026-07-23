import test from "node:test";
import assert from "node:assert/strict";
import { upstreamHostKey, withUpstreamLimit } from "../dist/upstream.js";

test("upstreamHostKey clasifica TC", () => {
  assert.equal(
    upstreamHostKey(
      "https://buscador-backend.tcchile.cl/api/extended/sentencias",
    ),
    "tc",
  );
});

test("upstreamHostKey clasifica OpenAlex", () => {
  assert.equal(
    upstreamHostKey("https://api.openalex.org/works?search=derecho"),
    "openalex",
  );
});

test("upstreamHostKey clasifica LeyChile", () => {
  assert.equal(
    upstreamHostKey("https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=1"),
    "leychile",
  );
});

test("upstreamHostKey usa websearch por defecto", () => {
  assert.equal(
    upstreamHostKey("https://html.duckduckgo.com/html/?q=test"),
    "websearch",
  );
});

test("websearch permite concurrencia limitada sin serializar la operación completa", async () => {
  let running = 0;
  let maxRunning = 0;
  const job = (n) =>
    withUpstreamLimit(`https://search-${n}.example.test/`, async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 180));
      running -= 1;
      return n;
    });

  const values = await Promise.all([job(1), job(2), job(3)]);
  assert.deepEqual(values, [1, 2, 3]);
  assert.ok(maxRunning >= 2, `concurrencia observada: ${maxRunning}`);
});
