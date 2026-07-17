import test from "node:test";
import assert from "node:assert/strict";
import { mapDoajHit } from "../dist/sources/doaj.js";
import {
  enrichDoctrineQuery,
  formatDoctrineCitationChile,
  normalizeAuthorName,
  rankDoctrineRecords,
  scoreDoctrineRecord,
  dedupeDoctrineRecords,
} from "../dist/sources/doctrineShared.js";
import { inferMetaFromPastedText } from "../dist/sources/jurisQuote.js";
import { normalizeTcSearchQuery } from "../dist/sources/tcBuscador.js";

test("mapDoajHit mapea artículo DOAJ a DoctrineRecord", () => {
  const rec = mapDoajHit({
    bibjson: {
      title: "Protección de datos personales en Chile",
      author: [{ name: "Ana Pérez" }, { name: "Luis Soto" }],
      year: "2021",
      journal: {
        title: "Revista Chilena de Derecho",
        country: "CL",
        volume: "48",
        number: "1",
      },
      start_page: 123,
      end_page: 150,
      abstract: "Estudio sobre la Ley 19.628 y el derecho a la vida privada.",
      identifier: [{ type: "doi", id: "10.4067/S0718-34372021000100123" }],
      link: [
        {
          type: "fulltext",
          url: "https://example.org/art",
          content_type: "text/html",
        },
        { type: "pdf", url: "https://example.org/art.pdf" },
      ],
    },
  });
  assert.ok(rec);
  assert.equal(rec.provider, "doaj");
  assert.equal(rec.country, "CL");
  assert.equal(rec.doi, "10.4067/S0718-34372021000100123");
  assert.equal(rec.volume, "48");
  assert.equal(rec.issue, "1");
  assert.equal(rec.pages, "123-150");
  assert.match(rec.citationChile, /Pérez, A\./);
  assert.match(rec.citationChile, /vol\. 48/);
  assert.ok(rec.pdfUrl?.endsWith(".pdf"));
});

test("normalizeAuthorName produce Apellido, N.", () => {
  assert.equal(normalizeAuthorName("Ana Pérez"), "Pérez, A.");
  assert.equal(normalizeAuthorName("Pérez, Ana María"), "Pérez, A. M.");
});

test("formatDoctrineCitationChile incluye páginas y DOI", () => {
  const cite = formatDoctrineCitationChile({
    authors: ["Pérez, A."],
    title: "Datos personales",
    journal: "Revista Chilena de Derecho",
    year: "2021",
    volume: "48",
    pages: "10-20",
    doi: "10.4067/x",
  });
  assert.match(cite, /Pérez, A\. \(2021\)/);
  assert.match(cite, /pp\. 10-20/);
  assert.match(cite, /DOI: 10\.4067\/x/);
});

test("enrichDoctrineQuery añade derecho Chile cuando falta", () => {
  assert.match(enrichDoctrineQuery("despido injustificado", "CL"), /derecho/i);
  assert.equal(
    enrichDoctrineQuery("derecho a la vida Chile", "CL"),
    "derecho a la vida Chile",
  );
});

test("rankDoctrineRecords prioriza relevancia temática sobre metadata rica off-topic", () => {
  const ranked = rankDoctrineRecords(
    [
      {
        title: "Agronomía tropical en suelos volcánicos",
        authors: ["X"],
        authorsShort: "X",
        url: "https://a.example",
        doi: "10.1/off",
        abstract: "Cultivos y fertilizantes en Chile",
        journal: "Revista agronómica",
        citationChile: "x",
        citationApa: "x",
        provider: "crossref",
        pdfUrl: "https://a.example/a.pdf",
        country: "CL",
      },
      {
        title: "Protección de datos personales",
        authors: ["A"],
        authorsShort: "A",
        url: "https://b.example",
        abstract: "Ley 19.628 y datos",
        journal: "Revista Chilena de Derecho",
        citationChile: "y",
        citationApa: "y",
        provider: "doaj",
        country: "CL",
      },
    ],
    "protección de datos personales",
    new Set(["revista chilena de derecho"]),
  );
  assert.match(ranked[0].title, /Protección de datos/i);
});

test("rankDoctrineRecords prioriza abstract DOI y catálogo", () => {
  const ranked = rankDoctrineRecords(
    [
      {
        title: "Nota genérica",
        authors: [],
        authorsShort: "s/a",
        url: "https://a.example",
        citationChile: "x",
        citationApa: "x",
        provider: "crossref",
      },
      {
        title: "Protección de datos personales",
        authors: ["A"],
        authorsShort: "A",
        url: "https://b.example",
        doi: "10.1/x",
        abstract: "Ley 19.628 y datos",
        journal: "Revista Chilena de Derecho",
        citationChile: "y",
        citationApa: "y",
        provider: "doaj",
        country: "CL",
      },
    ],
    "protección de datos personales",
    new Set(["revista chilena de derecho"]),
  );
  assert.match(ranked[0].title, /Protección de datos/i);
  assert.ok(
    scoreDoctrineRecord(
      ranked[0],
      "protección de datos personales",
      new Set(["revista chilena de derecho"]),
    ) >
      scoreDoctrineRecord(
        ranked[1],
        "protección de datos personales",
        new Set(["revista chilena de derecho"]),
      ),
  );
});

test("dedupeDoctrineRecords regenera cita tras merge de abstract", () => {
  const merged = dedupeDoctrineRecords([
    {
      title: "Art",
      authors: ["Pérez, A."],
      authorsShort: "Pérez, A.",
      doi: "10.4067/s1",
      url: "https://openalex.org/1",
      citationChile: "vieja",
      citationApa: "vieja",
      provider: "openalex",
      abstract: "Resumen útil",
      year: "2020",
      journal: "Revista Chilena de Derecho",
    },
    {
      title: "Art",
      authors: ["Pérez, A."],
      authorsShort: "Pérez, A.",
      doi: "10.4067/s1",
      url: "https://scielo.cl/1",
      pdfUrl: "https://scielo.cl/1.pdf",
      citationChile: "b",
      citationApa: "b",
      provider: "scielo",
      scieloPid: "S1",
      year: "2020",
      journal: "Revista Chilena de Derecho",
      pages: "1-10",
    },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].provider, "scielo");
  assert.equal(merged[0].abstract, "Resumen útil");
  assert.ok(merged[0].pdfUrl);
  assert.match(merged[0].citationChile, /pp\. 1-10/);
  assert.notEqual(merged[0].citationChile, "vieja");
});

test("inferMetaFromPastedText detecta Corte Suprema y año", () => {
  const meta = inferMetaFromPastedText(`
CORTE SUPREMA
Sentencia
Rol 12345-2020
En Santiago, a 15 de marzo de 2021.
`);
  assert.equal(meta.tribunal, "Corte Suprema");
  assert.equal(meta.tipoResolucion, "Sentencia");
  assert.ok(meta.anio === "2020" || meta.anio === "2021");
  assert.match(meta.fecha ?? "", /marzo de 2021/i);
});

test("inferMetaFromPastedText detecta Corte de Apelaciones con ciudad", () => {
  const meta = inferMetaFromPastedText(`
CORTE DE APELACIONES DE VALPARAÍSO
Sentencia
Rol 88-2019
`);
  assert.match(meta.tribunal ?? "", /Valpara/i);
});

test("normalizeTcSearchQuery quita sobre/entre y pliega acentos en stopwords", () => {
  assert.equal(
    normalizeTcSearchQuery("derecho sobre la vida entre partes"),
    "derecho vida partes",
  );
});
