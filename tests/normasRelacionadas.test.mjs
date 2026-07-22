import test from "node:test";
import assert from "node:assert/strict";
import { normasRelacionadas } from "../dist/sources/legislacion.js";

function sparqlResult(vars, rows) {
  return {
    head: { vars },
    results: {
      bindings: rows.map((row) => {
        const binding = {};
        for (const [key, value] of Object.entries(row)) {
          if (value === undefined) continue;
          binding[key] =
            typeof value === "number"
              ? {
                  type: "typed-literal",
                  datatype: "http://www.w3.org/2001/XMLSchema#integer",
                  value: String(value),
                }
              : { type: "literal", value: String(value) };
        }
        return binding;
      }),
    },
  };
}

test("normasRelacionadas usa predicados directos y etiqueta la relación", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const body = sparqlResult(
      ["rel", "norma", "title", "number", "date", "code"],
      [
        {
          rel: "modificada por",
          norma: "http://datos.bcn.cl/recurso/cl/ley/x/2020-01-01/999",
          title: "MODIFICA LEY DE PRUEBA",
          number: "999",
          date: "2020-01-01",
          code: 999001,
        },
      ],
    );
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/sparql-results+json" },
    });
  };

  try {
    const res = await normasRelacionadas("555000-test-unique");
    assert.equal(res.results.length, 1);
    const [hit] = res.results;
    assert.match(hit.citation, /^\[modificada por\]/);
    assert.equal(hit.metadata?.relacion, "modificada por");
    assert.equal(hit.evidence, "metadata");
    assert.equal(hit.url, "https://www.bcn.cl/leychile/navegar?idNorma=999001");
    assert.ok(
      res.warnings?.some((w) => /relaciones estructuradas/i.test(w)),
      `warnings: ${JSON.stringify(res.warnings)}`,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("normasRelacionadas informa cuando BCN no tiene relaciones estructuradas", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const body = sparqlResult(["rel", "norma", "title", "number", "date", "code"], []);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/sparql-results+json" },
    });
  };

  try {
    const res = await normasRelacionadas("555001-test-unique");
    assert.equal(res.results.length, 0);
    assert.ok(
      res.warnings?.some((w) => /no registra relaciones estructuradas/i.test(w)),
      `warnings: ${JSON.stringify(res.warnings)}`,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("normasRelacionadas degrada con warning si SPARQL falla", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };

  try {
    const res = await normasRelacionadas("555002-test-unique");
    assert.equal(res.results.length, 0);
    assert.ok(
      res.warnings?.some((w) => /No se pudieron obtener relaciones SPARQL/i.test(w)),
      `warnings: ${JSON.stringify(res.warnings)}`,
    );
  } finally {
    globalThis.fetch = original;
  }
});
