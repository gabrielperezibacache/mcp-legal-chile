import test from "node:test";
import assert from "node:assert/strict";
import {
  isUpstreamCoolingDown,
  noteTerminalUpstreamFailure,
  resetUpstreamForTests,
  upstreamHostKey,
  upstreamStatus,
  withUpstreamLimit,
} from "../dist/upstream.js";

test.beforeEach(() => {
  resetUpstreamForTests();
});

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

test("upstreamHostKey clasifica LeyChile XML aparte de BCN HTML", () => {
  assert.equal(
    upstreamHostKey("https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=1"),
    "leychile",
  );
  assert.equal(
    upstreamHostKey(
      "https://www.bcn.cl/leychile/consulta/buscador?termino=despido",
    ),
    "bcn",
  );
  assert.equal(upstreamHostKey("https://datos.bcn.cl/sparql"), "bcn");
});

test("upstreamHostKey clasifica DOAJ en su propio circuito", () => {
  assert.equal(
    upstreamHostKey("https://doaj.org/api/v3/search/articles/derecho"),
    "doaj",
  );
});

test("upstreamHostKey usa websearch por defecto", () => {
  assert.equal(
    upstreamHostKey("https://html.duckduckgo.com/html/?q=test"),
    "websearch",
  );
});

test("abort/deadline no abre el circuito upstream", async () => {
  // Use websearch host (low min-interval) so the test stays fast.
  const url = "https://abort-circuit.example.test/q";
  for (let i = 0; i < 5; i++) {
    await assert.rejects(
      () =>
        withUpstreamLimit(url, async () => {
          throw new DOMException("Aborted", "AbortError");
        }),
      /Aborted|AbortError/,
    );
  }
  assert.equal(upstreamStatus().websearch.open, false);
  assert.equal(upstreamStatus().websearch.failures, 0);
});

test("fallos mid-call no abren el circuito; solo terminales", async () => {
  const url = "https://midcall-circuit.example.test/q";
  for (let i = 0; i < 5; i++) {
    await assert.rejects(
      () =>
        withUpstreamLimit(url, async () => {
          throw new Error(`HTTP 500 al consultar ${url}`);
        }),
      /HTTP 500/,
    );
  }
  assert.equal(upstreamStatus().websearch.open, false);

  noteTerminalUpstreamFailure(url, 500);
  noteTerminalUpstreamFailure(url, 500);
  noteTerminalUpstreamFailure(url, 500);
  assert.equal(upstreamStatus().websearch.open, true);
});

test("upstreamHostKey clasifica Contraloría (CGR) en su propio circuito", () => {
  assert.equal(
    upstreamHostKey("https://www.contraloria.cl/pdfbuscador/dictamenes/123456"),
    "contraloria",
  );
  assert.equal(
    upstreamHostKey("https://www.dipres.gob.cl/597/w3-multipropertyvalues"),
    "contraloria",
  );
});

test("upstreamHostKey clasifica PJUD en su propio circuito", () => {
  assert.equal(
    upstreamHostKey("https://www.pjud.cl/portal-unificado-sentencias"),
    "pjud",
  );
});

test("upstreamHostKey clasifica Diario Oficial en su propio circuito", () => {
  assert.equal(
    upstreamHostKey(
      "https://www.diariooficial.interior.gob.cl/edicionelectronica/index.php",
    ),
    "diariooficial",
  );
});

test("isUpstreamCoolingDown refleja circuito abierto", () => {
  resetUpstreamForTests();
  assert.equal(isUpstreamCoolingDown("leychile"), false);
  noteTerminalUpstreamFailure(
    "https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=1",
    500,
  );
  noteTerminalUpstreamFailure(
    "https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=1",
    500,
  );
  noteTerminalUpstreamFailure(
    "https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=1",
    500,
  );
  assert.equal(upstreamStatus().leychile.open, true);
  assert.equal(isUpstreamCoolingDown("leychile"), true);
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
