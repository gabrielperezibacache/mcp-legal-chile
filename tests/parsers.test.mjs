import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRol } from "../dist/parsers.js";

test("normalizeRol no infiere TC sin contexto", () => {
  const plain = normalizeRol("1234-2024");
  assert.equal(plain.likelyTc, false);
  assert.equal(plain.display, "1234-2024");
});

test("normalizeRol detecta TC por sufijo INA", () => {
  const tc = normalizeRol("9666-20-INA");
  assert.equal(tc.likelyTc, true);
  assert.ok(tc.searchTerms.includes("9666-20"));
});

test("normalizeRol expande año corto", () => {
  const rol = normalizeRol("rol 9666-20");
  assert.equal(rol.anio, "2020");
  assert.equal(rol.display, "9666-2020");
});
