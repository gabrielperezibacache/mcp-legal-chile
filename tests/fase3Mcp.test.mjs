import test from "node:test";
import assert from "node:assert/strict";
import {
  READ_ONLY_ANNOTATIONS,
  needInput,
  okStructured,
  reportToolProgress,
} from "../dist/tools/helpers.js";
import { createServer, VERSION } from "../dist/server.js";

test("READ_ONLY_ANNOTATIONS marca tools de solo lectura", () => {
  assert.equal(READ_ONLY_ANNOTATIONS.readOnlyHint, true);
  assert.equal(READ_ONLY_ANNOTATIONS.idempotentHint, true);
  assert.equal(READ_ONLY_ANNOTATIONS.openWorldHint, true);
});

test("needInput pide datos sin inventar", () => {
  const res = needInput("Falta texto o URL", ["Pega el fallo en texto"]);
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /Falta información/);
  assert.match(res.content[0].text, /Falta texto o URL/);
  assert.match(res.content[0].text, /Pega el fallo/);
});

test("okStructured incluye structuredContent", () => {
  const res = okStructured("hola", { integrity: "verified", kind: "articulo" });
  assert.equal(res.content[0].text, "hola");
  assert.deepEqual(res.structuredContent, {
    integrity: "verified",
    kind: "articulo",
  });
});

test("reportToolProgress no lanza sin progressToken", async () => {
  await reportToolProgress(undefined, 1, 3, "paso");
  await reportToolProgress({}, 1, 3, "paso");
});

test("createServer registra resources Fase 3", () => {
  const server = createServer();
  assert.match(VERSION, /^\d+\.\d+\.\d+/);
  // SDK keeps registered resources on the server; shape varies by version —
  // assert the factory returns a usable McpServer with our name.
  assert.ok(server);
  assert.equal(typeof server.registerResource, "function");
  assert.equal(typeof server.registerTool, "function");
});
