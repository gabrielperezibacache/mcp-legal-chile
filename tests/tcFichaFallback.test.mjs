import test from "node:test";
import assert from "node:assert/strict";
import { obtenerFalloTc } from "../dist/sources/jurisprudencia.js";
import { citarJurisprudencia } from "../dist/sources/jurisQuote.js";

const DOCTRINA =
  "La declaración de inconstitucionalidad de un precepto legal con efectos erga omnes es una atribución del Tribunal Constitucional que en este caso concreto se fundamenta en la trasgresión de los derechos constitucionales invocados por el requirente en su libelo.";

function mockFetch(url) {
  const u = String(url);
  if (u.includes("/api/extended/sentencias")) {
    // Simulate: this ROL is not indexed in the free-text search.
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { count: 0, results: [] } }),
    };
  }
  if (u.includes("/api/buscadorexterno/ficha/")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          id: 888,
          folio: "1710",
          nombre: "INC-STC",
          fecha_sentencia: "2010-07-27 04:00:00",
          exist_file: 1,
          template: { complete_name: "Inconstitucionalidad de Precepto Legal" },
          detalle: [
            {
              parametro: { nombre: "Doctrina" },
              valor: DOCTRINA,
            },
            {
              parametro: { nombre: "Resultado" },
              valor: "Acoge",
            },
            {
              parametro: { nombre: "Tipo de resolución" },
              valor: "Sentencia",
            },
          ],
        },
      }),
    };
  }
  throw new Error(`unexpected fetch: ${u}`);
}

test("obtenerFalloTc cae a la ficha cuando el ROL no está en el índice de texto", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => mockFetch(url);
  try {
    const pack = await obtenerFalloTc("1710-10");
    assert.equal(pack.rol, "1710-2010");
    assert.equal(pack.resultado, "Acoge");
    assert.match(pack.doctrina ?? "", /inconstitucionalidad/i);
    assert.match(pack.markdown, /no indexado en el buscador de texto íntegro/i);
    assert.match(pack.markdown, /`metadata`/);
  } finally {
    globalThis.fetch = original;
  }
});

test("citarJurisprudencia cae a la ficha (evidence=metadata) sin considerando", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => mockFetch(url);
  try {
    const quote = await citarJurisprudencia({ rol: "1710-10" });
    assert.equal(quote.evidence, "metadata");
    assert.match(quote.texto, /inconstitucionalidad/i);
    assert.match(quote.markdown, /`metadata`/);
    assert.ok(
      quote.warnings.some((w) =>
        /no indexada en el buscador de texto/i.test(w),
      ),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("citarJurisprudencia rechaza considerando explícito cuando solo hay ficha (sin inventar)", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => mockFetch(url);
  try {
    await assert.rejects(
      () => citarJurisprudencia({ rol: "1710-10", considerando: "5" }),
      /no está indexado en el buscador de texto íntegro del TC/i,
    );
  } finally {
    globalThis.fetch = original;
  }
});
