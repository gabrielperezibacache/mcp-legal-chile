import test from "node:test";
import assert from "node:assert/strict";
import {
  ArticleNotFoundError,
  findArticulo,
  findIncisoOrLiteral,
  FragmentNotFoundError,
  requireArticulo,
  UnsupportedNormaStructureError,
} from "../dist/sources/normaTexto.js";

const sampleArt = {
  numero: "19",
  texto: "Artículo completo.",
  incisos: [
    { label: "1", texto: "Primer inciso." },
    { label: "2", texto: "Segundo inciso." },
  ],
  literales: [{ letra: "a", texto: "Literal a." }],
  url: "https://example.test",
  idParte: "1",
};

const sampleNorma = {
  idNorma: "test",
  titulo: "Norma de prueba",
  url: "https://example.test",
  xmlUrl: "https://example.test/xml",
  materias: [],
  organismos: [],
  partes: [],
  articulos: [
    { ...sampleArt, numero: "10", texto: "Artículo diez." },
    { ...sampleArt, numero: "19", texto: "Artículo diecinueve." },
  ],
};

test("findArticulo exige coincidencia exacta normalizada", () => {
  assert.equal(findArticulo(sampleNorma, "1"), undefined);
  assert.equal(findArticulo(sampleNorma, "10")?.numero, "10");
  assert.equal(findArticulo(sampleNorma, "artículo 19°")?.numero, "19");
});

test("requireArticulo lanza error claro si no existe", () => {
  assert.throws(
    () => requireArticulo(sampleNorma, "1"),
    (error) =>
      error instanceof ArticleNotFoundError &&
      error.message.includes("Artículo no encontrado") &&
      error.message.includes("10, 19"),
  );
});

test("requireArticulo lanza si el artículo no tiene texto parseable", () => {
  const norma = {
    ...sampleNorma,
    articulos: [{ ...sampleArt, numero: "1", texto: "   " }],
  };
  assert.throws(
    () => requireArticulo(norma, "1"),
    (error) =>
      error instanceof UnsupportedNormaStructureError &&
      error.message.includes("no trae texto parseable"),
  );
});

test("findIncisoOrLiteral devuelve artículo si no hay fragmento", () => {
  const frag = findIncisoOrLiteral(sampleArt, {});
  assert.equal(frag.kind, "articulo");
  assert.equal(frag.texto, "Artículo completo.");
});

test("findIncisoOrLiteral encuentra inciso", () => {
  const frag = findIncisoOrLiteral(sampleArt, { inciso: "2" });
  assert.equal(frag.kind, "inciso");
  assert.equal(frag.texto, "Segundo inciso.");
});

test("findIncisoOrLiteral lanza si inciso no existe", () => {
  assert.throws(
    () => findIncisoOrLiteral(sampleArt, { inciso: "9" }),
    (error) => error instanceof FragmentNotFoundError,
  );
});

test("findIncisoOrLiteral lanza si letra no existe", () => {
  assert.throws(
    () => findIncisoOrLiteral(sampleArt, { letra: "z" }),
    (error) => error instanceof FragmentNotFoundError,
  );
});
