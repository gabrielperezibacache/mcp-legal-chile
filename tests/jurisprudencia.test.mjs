import test from "node:test";
import assert from "node:assert/strict";
import {
  buildJurisCitation,
  rankJurisprudenciaResults,
  scoreCourtHit,
  scoreJurisprudenciaHit,
} from "../dist/sources/jurisprudencia.js";
import { matchTribunalPortal } from "../dist/sources/tribunalesCatalog.js";
import {
  extractRolMention,
  normalizeRol,
  parseCaseIdentifiers,
  rolMatches,
} from "../dist/parsers.js";
import { webHitsToCitations } from "../dist/sources/websearch.js";
import { formatChileanCitation } from "../dist/citation.js";
import { tcCitation } from "../dist/sources/tcBuscador.js";

test("matchTribunalPortal ignora acentos", () => {
  assert.equal(
    matchTribunalPortal("Corte de Apelaciónes")?.id,
    "ca",
  );
  assert.equal(matchTribunalPortal("Garantia")?.id, "garantia");
  assert.equal(
    matchTribunalPortal("Tribunal Constitucional")?.id,
    "tc",
  );
});

test("rolMatches exige mismo número y año", () => {
  const target = normalizeRol("9666-2020");
  assert.equal(rolMatches("9666-20", target), true);
  assert.equal(rolMatches("9666-2020-INA", target), true);
  assert.equal(rolMatches("966-2020", target), false);
  assert.equal(rolMatches("9666-2021", target), false);
});

test("extractRolMention detecta ROL explícito", () => {
  assert.equal(
    extractRolMention("ver sentencia rol 1234-2020 sobre despido"),
    "1234-2020",
  );
  assert.equal(extractRolMention("despido injustificado"), undefined);
});

test("scoreCourtHit prioriza dominios oficiales y keywords", () => {
  const official = scoreCourtHit(
    "Sentencia Corte Suprema",
    "https://www.pjud.cl/portal/getRuling",
    "rol 1234-2020",
  );
  const blog = scoreCourtHit(
    "Opinión sobre tribunales",
    "https://example.com/blog",
    "comentario general",
  );
  assert.ok(official > blog);
  assert.ok(official >= 18);
  assert.ok(blog < 18);
});

test("rankJurisprudenciaResults ordena por relevancia de consulta", () => {
  const ranked = rankJurisprudenciaResults(
    [
      {
        source: "jurisprudencia",
        title: "Nota genérica sobre cortes",
        citation: "blog",
        url: "https://example.com/x",
        evidence: "link_only",
      },
      {
        source: "jurisprudencia",
        title: "TC rol 5174 — Inaplicabilidad",
        citation: "Tribunal Constitucional, rol 5174",
        summary: "derecho a la vida y protección de datos",
        url: "https://buscador.tcchile.cl/#/ficha/5174",
        tribunal: "Tribunal Constitucional",
        rol: "5174-2019",
        evidence: "metadata",
        metadata: { provider: "tc_buscador" },
      },
    ],
    "protección de datos personales",
  );
  assert.equal(ranked[0].rol, "5174-2019");
  assert.ok(
    scoreJurisprudenciaHit(ranked[0], "protección de datos personales") >
      scoreJurisprudenciaHit(ranked[1], "protección de datos personales"),
  );
});

test("webHitsToCitations no usa el título crudo como cita jurídica", () => {
  const [hit] = webHitsToCitations(
    [
      {
        title: "Poder Judicial - Causa rol 12345-2020 Corte Suprema Sentencia",
        url: "https://www.pjud.cl/portal/getRuling?id=1",
        snippet: "Sentencia de la Corte Suprema rol 12345-2020",
      },
    ],
    "jurisprudencia",
    "Poder Judicial de Chile",
  );
  assert.ok(hit);
  assert.notEqual(hit.citation, hit.title);
  assert.match(hit.citation, /rol 12345-2020/i);
  assert.equal(hit.evidence, "link_only");
  assert.ok(hit.rol);
});

test("buildJurisCitation marca candidato sin ROL", () => {
  const cite = buildJurisCitation({
    titleFallback: "Portal de noticias judiciales",
  });
  assert.match(cite, /^Candidato \(verificar\):/);
});

test("tcCitation alinea con formatChileanCitation", () => {
  const a = tcCitation("5174-2019", {
    tipoResolucion: "Sentencia",
    anio: "2019",
  });
  const b = formatChileanCitation({
    tribunal: "Tribunal Constitucional",
    tipo: "Sentencia",
    rol: "5174-2019",
    anio: "2019",
  }).citation;
  assert.equal(a, b);
});

test("parseCaseIdentifiers detecta tipo y tribunal", () => {
  const ids = parseCaseIdentifiers(
    "Sentencia Corte Suprema rol 99-2021",
    "despido",
  );
  assert.equal(ids.tipo, "Sentencia");
  assert.equal(ids.tribunal, "Corte Suprema");
  assert.ok(ids.rol);
});
