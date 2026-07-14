import type { CitationResult, SearchResponse } from "../types.js";
import {
  escapeSparqlString,
  fetchJson,
  uniqueByUrl,
} from "../util.js";

const SPARQL_ENDPOINT = "https://datos.bcn.cl/sparql";

interface SparqlBinding {
  [key: string]: { type: string; value: string; datatype?: string };
}

interface SparqlResponse {
  results: { bindings: SparqlBinding[] };
}

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
    metadata: {
      leychileCode: code,
      tipo,
      organismo,
      bcnUri: norma,
    },
  };
}

export async function searchLegislacion(
  query: string,
  limit = 8,
): Promise<SearchResponse> {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .slice(0, 6)
    .map((t) => t.toLowerCase());

  if (terms.length === 0) {
    return {
      query,
      source: "legislacion",
      results: [],
      warnings: ["La consulta es demasiado corta."],
    };
  }

  const filters = terms
    .map(
      (t) =>
        `FILTER(CONTAINS(LCASE(STR(?title)), "${escapeSparqlString(t)}") || CONTAINS(LCASE(STR(?label)), "${escapeSparqlString(t)}"))`,
    )
    .join("\n  ");

  const sparql = `
PREFIX bcnnorms: <http://datos.bcn.cl/ontologies/bcn-norms#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX dc: <http://purl.org/dc/elements/1.1/>

SELECT DISTINCT ?norma ?title ?label ?number ?date ?code ?tipoNombre ?organismo
WHERE {
  ?norma a bcnnorms:Norm .
  OPTIONAL { ?norma dc:title ?title }
  OPTIONAL { ?norma rdfs:label ?label }
  OPTIONAL { ?norma bcnnorms:hasNumber ?number }
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
  ${filters}
}
ORDER BY DESC(?date)
LIMIT ${Math.min(Math.max(limit * 2, 10), 40)}
`.trim();

  const body = new URLSearchParams({ query: sparql });
  const data = await fetchJson<SparqlResponse>(SPARQL_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/sparql-results+json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const results = uniqueByUrl(
    data.results.bindings
      .map(toCitation)
      .filter((r): r is CitationResult => r !== null),
  ).slice(0, limit);

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
            "No se encontraron normas en el endpoint SPARQL de la BCN. Prueba con términos más específicos (p. ej. número de ley).",
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

    const data = await fetchJson<SparqlResponse>(SPARQL_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ query: sparql }),
    });

    const results = uniqueByUrl(
      data.results.bindings
        .map(toCitation)
        .filter((r): r is CitationResult => r !== null),
    );

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
    return searchLegislacion(`ley ${opts.number}`, 5);
  }

  return searchLegislacion(opts.query ?? "", 8);
}
