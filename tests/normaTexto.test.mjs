import test from "node:test";
import assert from "node:assert/strict";
import {
  ArticleNotFoundError,
  decodeEntities,
  findArticulo,
  findIncisoOrLiteral,
  flattenArticles,
  FragmentNotFoundError,
  normalizeArticleNumber,
  normalizeFromNombreParte,
  parseIncisosAndLiterales,
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

test("normalizeArticleNumber ancla al inicio del texto, ignora referencias cruzadas", () => {
  assert.equal(
    normalizeArticleNumber("Art. 127. El viudo... el articulo 124..."),
    "127",
  );
  assert.equal(normalizeArticleNumber("Articulo 58 bis.- Nombre es..."), "58 bis");
  assert.equal(normalizeArticleNumber("Art. 2 o. La costumbre..."), "2");
  assert.equal(normalizeArticleNumber("Texto sin encabezado de articulo."), undefined);
});

test("normalizeFromNombreParte extrae numero y quita el sufijo DEL ART", () => {
  assert.equal(normalizeFromNombreParte("12 (DEL ART. 2)"), "12");
  assert.equal(normalizeFromNombreParte("58 bis"), "58 bis");
  assert.equal(normalizeFromNombreParte("del Articulo 2"), undefined);
});

test("flattenArticles usa tipoParte decodificado (Art&#237;culo) para reconocer articulos", () => {
  const parts = [
    {
      tipo: "Art\u00edculo",
      idParte: "1",
      texto: "Art. 44. La ley distingue tres especies de culpa.",
      children: [],
    },
  ];
  const out = flattenArticles(parts, "172986");
  assert.equal(out.length, 1);
  assert.equal(out[0].numero, "44");
});

test("flattenArticles usa nombreParte como respaldo cuando el texto no trae encabezado", () => {
  const parts = [
    {
      tipo: "Articulo",
      idParte: "9",
      nombreParte: "58 bis",
      texto: "Sin encabezado reconocible en el cuerpo.",
      children: [],
    },
  ];
  const out = flattenArticles(parts, "172986");
  assert.equal(out.length, 1);
  assert.equal(out[0].numero, "58 bis");
});

test("decodeEntities preserva saltos de parrafo indentados (LeyChile fixed-width)", () => {
  const raw =
    "     Art. 44. La ley distingue tres especies de culpa.\n\n     Culpa grave es aquella.\n\n     Culpa leve es otra.";
  const decoded = decodeEntities(raw);
  const paragraphs = decoded.split("\n\n");
  assert.equal(paragraphs.length, 3);
  assert.ok(paragraphs[0].includes("distingue tres especies"));
  assert.ok(paragraphs[1].includes("Culpa grave"));
  assert.ok(paragraphs[2].includes("Culpa leve"));
});

test("decodeEntities une lineas envueltas de un mismo parrafo", () => {
  const raw = "     Art. 1698. Incumbe probar las\nobligaciones al que\nalega aquellas.";
  const decoded = decodeEntities(raw);
  assert.equal(decoded.includes("\n"), false);
  assert.ok(decoded.includes("Incumbe probar las obligaciones al que alega aquellas."));
});

test("parseIncisosAndLiterales aprovecha los saltos de parrafo para detectar incisos implicitos", () => {
  const texto =
    "Art. 44. La ley distingue tres especies de culpa o descuido.\n\n     Culpa grave, negligencia grave, es la que consiste en no manejar los negocios ajenos con cuidado.\n\n     Culpa leve, descuido leve, es la falta de aquella diligencia y cuidado ordinario.";
  const { incisos } = parseIncisosAndLiterales(texto);
  assert.ok(incisos.length >= 2);
});
