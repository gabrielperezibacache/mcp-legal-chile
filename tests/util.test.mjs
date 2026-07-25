import test from "node:test";
import assert from "node:assert/strict";
import { decodeHtmlEntities, stripHtml } from "../dist/util.js";

test("decodeHtmlEntities decodifica vocales acentuadas y ñ", () => {
  assert.equal(
    decodeHtmlEntities("Corte Suprema confirm&oacute; fallo"),
    "Corte Suprema confirmó fallo",
  );
  assert.equal(decodeHtmlEntities("acogi&oacute; demanda"), "acogió demanda");
  assert.equal(decodeHtmlEntities("cl&iacute;nica"), "clínica");
  assert.equal(decodeHtmlEntities("dise&ntilde;o"), "diseño");
});

test("decodeHtmlEntities conserva el texto cuando no hay entidad conocida", () => {
  assert.equal(
    decodeHtmlEntities("Sin entidades aqu\u00ed"),
    "Sin entidades aqu\u00ed",
  );
  assert.equal(decodeHtmlEntities("&foobar;"), "&foobar;");
});

test("decodeHtmlEntities soporta entidades numéricas decimales y hex", () => {
  assert.equal(decodeHtmlEntities("&#243;rgano"), "\u00f3rgano");
  assert.equal(decodeHtmlEntities("&#xf3;rgano"), "\u00f3rgano");
});

test("stripHtml quita etiquetas y decodifica entidades combinadas", () => {
  assert.equal(
    stripHtml(
      "<b>Corte Suprema</b> acogi&oacute; el recurso &amp; confirm&oacute; la sentencia",
    ),
    "Corte Suprema acogió el recurso & confirmó la sentencia",
  );
});
