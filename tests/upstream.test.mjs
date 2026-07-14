import test from "node:test";
import assert from "node:assert/strict";
import { upstreamHostKey } from "../dist/upstream.js";

test("upstreamHostKey clasifica TC", () => {
  assert.equal(
    upstreamHostKey("https://buscador-backend.tcchile.cl/api/extended/sentencias"),
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
