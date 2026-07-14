import test from "node:test";
import assert from "node:assert/strict";
import {
  findIncisoOrLiteral,
  FragmentNotFoundError,
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
