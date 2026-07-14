import type { CitationResult, SearchResponse } from "../types.js";
import { resolveHotNorma } from "../catalog.js";
import { sparqlCache } from "../cache.js";
import {
  escapeSparqlString,
  fetchJson,
  uniqueByUrl,
} from "../util.js";

const SPARQL_ENDPOINT = "https://datos.bcn.cl/sparql";
const SPARQL_TIMEOUT_MS = Number(process.env.SPARQL_TIMEOUT_MS ?? 60_000);

interface SparqlBinding {
  [key: string]: { type: string; value: string; datatype?: string };
}

interface SparqlResponse {
  results: { bindings: SparqlBinding[] };
}

const STOPWORDS = new Set([
  "ley",
  "dl",
  "dfl",
  "dto",
  "decreto",
  "sobre",
  "para",
  "con",
  "del",
  "de",
  "la",
  "las",
  "los",
  "el",
  "una",
  "uno",
  "y",
  "o",
  "en",
  "por",
]);

function bindingValue(b: SparqlBinding, key: string): string | undefined {
  return b[key]?.value;
}

function leyChileUrl(code?: string, fallbackUri?: string): string {
  if (code) {
    return `https://www.bcn.cl/leychile/navegar?idNorma=${code}`;
  }
  return fallbackUri ?? "https://www.bcn.cl/leychile/";
}

function toCitation(b: SparqlBinding): CitationResult | null {
  const title = bindingValue(b, "title") ?? bindingValue(b, "label");
  if (!title) return null;
  const code = bindingValue(b, "code");
  const number = bindingValue(b, "number");
  const date = bindingValue(b, "date");
  const norma = bindingValue(b, "norma");
  const tipo = bindingValue(b, "tipoNombre");
  const organismo = bindingValue(b, "organismo");

  const citationParts = [
    tipo ? tipo : number ? `Norma ${number}` : undefined,
    number && !tipo?.toLowerCase().includes(number.toLowerCase())
      ? `N° ${number}`
      : undefined,
    date ? `(${date})` : undefined,
  ].filter(Boolean);

  return {
    source: "legislacion",
    title: title.trim(),
    citation: citationParts.join(" ") || title.trim(),
    date,
    url: leyChileUrl(code, norma),
    secondaryUrl: norma,
    publisher: organismo ?? "Biblioteca del Congreso Nacional / LeyChile",
    id: code,
    evidence: "metadata",
    metadata: {
      leychileCode: code,
      tipo,
      organismo,
      bcnUri: norma,
    },
  };
}

async function runSparql(sparql: string): Promise<SparqlResponse> {
  const key = `sparql:${sparql.replace(/\s+/g, " ").trim()}`;
  return sparqlCache.getOrSet(key, () =>
    fetchJson<SparqlResponse>(
      SPARQL_ENDPOINT,
      {
        method: "POST",
        headers: {
          Accept: "application/sparql-results+json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ query: sparql }),
      },
      SPARQL_TIMEOUT_MS,
    ),
  );
}

function extractLawNumber(query: string): string | undefined {
  const dotted = query.match(/\b(\d{1,2})\.(\d{3})\b/);
  if (dotted) return `${dotted[1]}${dotted[2]}`;
  const plain = query.match(/\b(\d{4,6})\b/);
  return plain?.[1];
}

function searchTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}.-]/gu, ""))
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .slice(0, 4);
}

function bindingsToResults(
  bindings: SparqlBinding[],
  limit: number,
): CitationResult[] {
  return uniqueByUrl(
    bindings.map(toCitation).filter((r): r is CitationResult => r !== null),
  ).slice(0, limit);
}

export async function searchLegislacion(
  query: string,
  limit = 8,
): Promise<SearchResponse> {
  const hot = resolveHotNorma(query);
  if (hot) {
    const byId = await getNorma({ leychileCode: hot.idNorma });
    if (byId.results.length > 0) {
      return {
        ...byId,
        query,
        warnings: [
          ...(byId.warnings ?? []),
          `Resuelto por catálogo de normas frecuentes: ${hot.label} (idNorma ${hot.idNorma}).`,
        ],
      };
    }
  }

  const lawNumber = extractLawNumber(query);
  if (lawNumber) {
    const byNumber = await getNorma({ number: lawNumber });
    if (byNumber.results.length > 0) {
      return { ...byNumber, query };
    }
  }

  const terms = searchTerms(query);
  if (terms.length === 0) {
    return {
      query,
      source: "legislacion",
      results: [],
      warnings: ["La consulta es demasiado corta o genérica."],
      searchUrls: {
        leyChile: `https://www.bcn.cl/leychile/consulta/buscador?termino=${encodeURIComponent(query)}`,
      },
    };
  }

  // Prefer a lean query: title match + key fields only (faster on BCN).
  const filters = terms
    .map(
      (t) =>
        `FILTER(CONTAINS(LCASE(STR(?title)), "${escapeSparqlString(t)}"))`,
    )
    .join("\n  ");

  const sparql = `
PREFIX bcnnorms: <http://datos.bcn.cl/ontologies/bcn-norms#>
PREFIX dc: <http://purl.org/dc/elements/1.1/>

SELECT DISTINCT ?norma ?title ?number ?date ?code
WHERE {
  ?norma a bcnnorms:Norm .
  ?norma dc:title ?title .
  OPTIONAL { ?norma bcnnorms:hasNumber ?number }
  OPTIONAL { ?norma bcnnorms:publishDate ?date }
  OPTIONAL { ?norma bcnnorms:leychileCode ?code }
  ${filters}
}
ORDER BY DESC(?date)
LIMIT ${Math.min(Math.max(limit * 3, 12), 30)}
`.trim();

  const data = await runSparql(sparql);
  const results = bindingsToResults(data.results.bindings, limit);

  return {
    query,
    source: "legislacion",
    results,
    searchUrls: {
      leyChile: `https://www.bcn.cl/leychile/consulta/buscador?termino=${encodeURIComponent(query)}`,
      datosAbiertos: "https://datos.bcn.cl/es/",
    },
    warnings:
      results.length === 0
        ? [
            "No se encontraron normas en el endpoint SPARQL de la BCN. Prueba con el número de ley (p. ej. 19628).",
          ]
        : undefined,
  };
}

export async function getNorma(opts: {
  leychileCode?: string;
  number?: string;
  query?: string;
}): Promise<SearchResponse> {
  if (opts.leychileCode) {
    const code = opts.leychileCode.replace(/\D/g, "");
    const sparql = `
PREFIX bcnnorms: <http://datos.bcn.cl/ontologies/bcn-norms#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX dc: <http://purl.org/dc/elements/1.1/>

SELECT DISTINCT ?norma ?title ?label ?number ?date ?code ?tipoNombre ?organismo
WHERE {
  ?norma a bcnnorms:Norm .
  ?norma bcnnorms:leychileCode ?code .
  FILTER(?code = ${code})
  OPTIONAL { ?norma dc:title ?title }
  OPTIONAL { ?norma rdfs:label ?label }
  OPTIONAL { ?norma bcnnorms:hasNumber ?number }
  OPTIONAL { ?norma bcnnorms:publishDate ?date }
  OPTIONAL {
    ?norma bcnnorms:type ?tipo .
    ?tipo bcnnorms:hasName ?tipoNombre .
  }
  OPTIONAL {
    ?norma bcnnorms:createdBy ?org .
    ?org rdfs:label ?organismo .
  }
}
LIMIT 5
`.trim();

    const data = await runSparql(sparql);
    const results = bindingsToResults(data.results.bindings, 5);

    return {
      query: `idNorma=${code}`,
      source: "legislacion",
      results,
      searchUrls: {
        leyChile: leyChileUrl(code),
      },
    };
  }

  if (opts.number) {
    const number = opts.number.replace(/\D/g, "");
    const sparql = `
PREFIX bcnnorms: <http://datos.bcn.cl/ontologies/bcn-norms#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX dc: <http://purl.org/dc/elements/1.1/>

SELECT DISTINCT ?norma ?title ?label ?number ?date ?code ?tipoNombre ?organismo
WHERE {
  ?norma a bcnnorms:Norm .
  ?norma bcnnorms:hasNumber ?number .
  FILTER(STR(?number) = "${escapeSparqlString(number)}" || STR(?number) = "${escapeSparqlString(opts.number)}")
  OPTIONAL { ?norma dc:title ?title }
  OPTIONAL { ?norma rdfs:label ?label }
  OPTIONAL { ?norma bcnnorms:publishDate ?date }
  OPTIONAL { ?norma bcnnorms:leychileCode ?code }
  OPTIONAL {
    ?norma bcnnorms:type ?tipo .
    ?tipo bcnnorms:hasName ?tipoNombre .
  }
  OPTIONAL {
    ?norma bcnnorms:createdBy ?org .
    ?org rdfs:label ?organismo .
  }
}
ORDER BY DESC(?date)
LIMIT 10
`.trim();

    const data = await runSparql(sparql);
    const results = bindingsToResults(data.results.bindings, 8);
    return {
      query: `número=${opts.number}`,
      source: "legislacion",
      results,
      searchUrls: {
        leyChile: `https://www.bcn.cl/leychile/consulta/buscador?termino=${encodeURIComponent(opts.number)}`,
      },
      warnings:
        results.length === 0
          ? [`No se encontró norma con número ${opts.number} en BCN.`]
          : undefined,
    };
  }

  if (opts.query) {
    return searchLegislacion(opts.query, 8);
  }

  return {
    query: "",
    source: "legislacion",
    results: [],
    warnings: ["Indica id_norma, numero o consulta."],
  };
}

export async function estadoNorma(idNorma: string): Promise<Record<string, unknown>> {
  const code = idNorma.replace(/\D/g, "");
  const meta = await getNorma({ leychileCode: code });
  const result = meta.results[0];
  return {
    idNorma: code,
    titulo: result?.title,
    citation: result?.citation,
    fechaPublicacion: result?.date,
    url: result?.url ?? `https://www.bcn.cl/leychile/navegar?idNorma=${code}`,
    historiaUrl: `https://www.bcn.cl/leychile/navegar?idNorma=${code}&tipoVersion=H`,
    metadata: result?.metadata,
    warnings: [
      "Confirma vigencia y texto consolidado en LeyChile. El campo derogado del XML (si se pide con obtener_texto_norma) es la señal más fiable entre herramientas públicas.",
      ...(meta.warnings ?? []),
    ],
  };
}

export async function normasRelacionadas(
  idNorma: string,
): Promise<SearchResponse> {
  const code = idNorma.replace(/\D/g, "");
  // BCN relationship predicates vary; try subjects/title proximity via same leychile family,
  // and always return historia deep-link.
  const sparql = `
PREFIX bcnnorms: <http://datos.bcn.cl/ontologies/bcn-norms#>
PREFIX dc: <http://purl.org/dc/elements/1.1/>

SELECT DISTINCT ?norma ?title ?number ?date ?code
WHERE {
  ?ref a bcnnorms:Norm .
  ?ref bcnnorms:leychileCode ?refCode .
  FILTER(?refCode = ${code})
  OPTIONAL { ?ref dc:title ?refTitle }
  ?norma a bcnnorms:Norm .
  ?norma dc:title ?title .
  OPTIONAL { ?norma bcnnorms:hasNumber ?number }
  OPTIONAL { ?norma bcnnorms:publishDate ?date }
  OPTIONAL { ?norma bcnnorms:leychileCode ?code }
  FILTER(BOUND(?refTitle) && CONTAINS(LCASE(STR(?title)), LCASE(SUBSTR(STR(?refTitle), 1, 18))))
  FILTER(?code != ${code})
}
ORDER BY DESC(?date)
LIMIT 12
`.trim();

  try {
    const data = await runSparql(sparql);
    const results = bindingsToResults(data.results.bindings, 8);
    return {
      query: `relacionadas idNorma=${code}`,
      source: "legislacion",
      results,
      warnings: [
        "Relaciones inferidas por similitud de título en BCN; verifica en la historia de la norma en LeyChile.",
      ],
      searchUrls: {
        historia: `https://www.bcn.cl/leychile/navegar?idNorma=${code}`,
      },
    };
  } catch (error) {
    return {
      query: `relacionadas idNorma=${code}`,
      source: "legislacion",
      results: [],
      warnings: [
        `No se pudieron inferir relaciones SPARQL: ${error instanceof Error ? error.message : String(error)}`,
        "Usa la historia oficial en LeyChile.",
      ],
      searchUrls: {
        historia: `https://www.bcn.cl/leychile/navegar?idNorma=${code}`,
      },
    };
  }
}
