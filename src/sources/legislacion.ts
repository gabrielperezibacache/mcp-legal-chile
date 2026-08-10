import type { CitationResult, SearchResponse } from "../types.js";
import { resolveHotNorma } from "../catalog.js";
import { sparqlCache } from "../cache.js";
import { isAbortLikeError } from "../deadline.js";
import { noteTerminalUpstreamFailure } from "../upstream.js";
import {
  decodeHtmlEntities,
  escapeSparqlString,
  fetchJson,
  fetchText,
  HttpStatusError,
  stripHtml,
  uniqueByUrl,
} from "../util.js";

function isCircuitOpenError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "CircuitOpenError" || /Circuito abierto/i.test(error.message)
  );
}

function networkFailureStatus(error: unknown): number | undefined {
  if (error instanceof HttpStatusError) return error.status;
  if (!(error instanceof Error)) return undefined;
  const m = error.message.match(/HTTP (\d+)/);
  return m ? Number(m[1]) : undefined;
}

const SPARQL_ENDPOINT = "https://datos.bcn.cl/sparql";
const SPARQL_TIMEOUT_MS = Number(process.env.SPARQL_TIMEOUT_MS ?? 10_000);

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
  const rel = bindingValue(b, "rel");

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
    citation:
      (rel ? `[${rel}] ` : "") + (citationParts.join(" ") || title.trim()),
    date,
    url: leyChileUrl(code, norma),
    secondaryUrl: norma,
    publisher: organismo ?? "Biblioteca del Congreso Nacional / LeyChile",
    id: code,
    evidence: "metadata",
    metadata: {
      integrity: "candidate",
      leychileCode: code,
      tipo,
      organismo,
      bcnUri: norma,
      relacion: rel,
    },
  };
}

async function runSparql(
  sparql: string,
  signal?: AbortSignal,
  countFailure: "terminal" | "none" = "terminal",
): Promise<SparqlResponse> {
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
      signal,
      countFailure,
    ),
  );
}

/** Exported for unit tests. Years alone are not law numbers. */
export function extractLawNumber(query: string): string | undefined {
  const dotted = query.match(/\b(\d{1,2})\.(\d{3})\b/);
  if (dotted) return `${dotted[1]}${dotted[2]}`;
  // Prefer "ley/núm … 19628" so bare years like "reforma 2024" do not short-circuit.
  const withContext = query.match(
    /\b(?:ley|l\.?|n[uú]m(?:ero)?\.?|n°|nº|no\.?)\s*(\d{4,6})\b/i,
  );
  if (withContext) return withContext[1];
  const plain = query.match(/\b(\d{4,6})\b/);
  if (!plain) return undefined;
  const n = Number(plain[1]);
  // Standalone calendar years are almost never Chilean law numbers in queries.
  if (n >= 1900 && n <= 2099) return undefined;
  return plain[1];
}

function foldLegisText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function searchTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}.-]/gu, ""))
    .filter((t) => t.length > 2 && !STOPWORDS.has(t) && !STOPWORDS.has(foldLegisText(t)))
    .slice(0, 4);
}

/** Token coverage of query terms in a legislación title (0..1). */
export function scoreLegislacionHit(
  hit: CitationResult,
  terms: string[],
): number {
  if (!terms.length) return 0;
  const hay = foldLegisText(`${hit.title} ${hit.citation} ${hit.summary ?? ""}`);
  let matched = 0;
  for (const t of terms) {
    if (hay.includes(foldLegisText(t))) matched += 1;
  }
  let score = matched / terms.length;
  // Prefer exact-ish multi-word presence
  if (terms.length >= 2) {
    const bigram = `${foldLegisText(terms[0]!)} ${foldLegisText(terms[1]!)}`;
    if (hay.includes(bigram)) score += 0.25;
  }
  return score;
}

export function rankLegislacionResults(
  results: CitationResult[],
  terms: string[],
): CitationResult[] {
  if (!terms.length) return results;
  const minCoverage =
    terms.length >= 3 ? 2 / terms.length : terms.length >= 2 ? 0.5 : 0;
  const scored = results
    .map((hit) => ({ hit, score: scoreLegislacionHit(hit, terms) }))
    .filter(({ score }) => score + 1e-9 >= minCoverage)
    .sort((a, b) => b.score - a.score);
  return scored.map((s) => s.hit);
}

function bindingsToResults(
  bindings: SparqlBinding[],
  limit: number,
): CitationResult[] {
  return uniqueByUrl(
    bindings.map(toCitation).filter((r): r is CitationResult => r !== null),
  ).slice(0, limit);
}

function buildTitleFilterSparql(
  terms: string[],
  mode: "and" | "or",
  limit: number,
): string {
  const filters =
    mode === "and"
      ? terms
          .map(
            (t) =>
              `FILTER(CONTAINS(LCASE(STR(?title)), "${escapeSparqlString(t)}"))`,
          )
          .join("\n  ")
      : `FILTER(${terms
          .map(
            (t) => `CONTAINS(LCASE(STR(?title)), "${escapeSparqlString(t)}")`,
          )
          .join(" || ")})`;

  return `
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
}

/** Parse LeyChile buscador HTML for idNorma links (exported for offline tests). */
export function parseLeyChileBuscadorHtml(
  html: string,
  limit = 8,
): CitationResult[] {
  const results: CitationResult[] = [];
  const seen = new Set<string>();
  const re = /href=["']([^"']*idNorma=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && results.length < limit) {
    const code = match[2]!;
    if (seen.has(code)) continue;
    seen.add(code);
    const title = stripHtml(decodeHtmlEntities(match[3] ?? "")).slice(0, 200);
    if (!title || title.length < 4) continue;
    results.push({
      source: "legislacion",
      title,
      citation: title,
      url: `https://www.bcn.cl/leychile/navegar?idNorma=${code}`,
      publisher: "Biblioteca del Congreso Nacional / LeyChile",
      id: code,
      evidence: "metadata",
      metadata: {
        integrity: "candidate",
        leychileCode: code,
        provider: "leychile_buscador",
      },
    });
  }
  // Fallback: bare idNorma URLs without anchor text
  if (!results.length) {
    const bare = html.matchAll(/idNorma=(\d+)/gi);
    for (const m of bare) {
      const code = m[1]!;
      if (seen.has(code)) continue;
      seen.add(code);
      results.push({
        source: "legislacion",
        title: `Norma idNorma ${code}`,
        citation: `idNorma ${code}`,
        url: `https://www.bcn.cl/leychile/navegar?idNorma=${code}`,
        publisher: "Biblioteca del Congreso Nacional / LeyChile",
        id: code,
        evidence: "metadata",
        metadata: {
          integrity: "candidate",
          leychileCode: code,
          provider: "leychile_buscador",
        },
      });
      if (results.length >= limit) break;
    }
  }
  return results;
}

async function searchLeyChileBuscador(
  query: string,
  limit: number,
  signal?: AbortSignal,
  countFailure: "terminal" | "none" = "terminal",
): Promise<CitationResult[]> {
  const url = `https://www.bcn.cl/leychile/consulta/buscador?termino=${encodeURIComponent(query)}`;
  const html = await fetchText(
    url,
    {
      headers: {
        Accept: "text/html,*/*",
        "Accept-Language": "es-CL,es;q=0.9",
      },
    },
    SPARQL_TIMEOUT_MS,
    signal,
    countFailure,
  );
  return parseLeyChileBuscadorHtml(html, limit);
}

export async function searchLegislacion(
  query: string,
  limit = 8,
  opts: { signal?: AbortSignal } = {},
): Promise<SearchResponse> {
  const searchUrls = {
    leyChile: `https://www.bcn.cl/leychile/consulta/buscador?termino=${encodeURIComponent(query)}`,
    datosAbiertos: "https://datos.bcn.cl/es/",
  };
  const warnings: string[] = [];
  let networkFailures = 0;
  let lastNetworkStatus: number | undefined;

  const noteStageNetworkError = (error: unknown): void => {
    if (isAbortLikeError(error) || isCircuitOpenError(error)) return;
    networkFailures += 1;
    lastNetworkStatus = networkFailureStatus(error) ?? lastNetworkStatus;
  };

  const hot = resolveHotNorma(query);
  if (hot) {
    try {
      const byId = await getNorma({
        leychileCode: hot.idNorma,
        signal: opts.signal,
        countFailure: "none",
      });
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
    } catch (error) {
      noteStageNetworkError(error);
      warnings.push(
        `Catálogo hot: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const lawNumber = extractLawNumber(query);
  if (lawNumber) {
    try {
      const byNumber = await getNorma({
        number: lawNumber,
        signal: opts.signal,
        countFailure: "none",
      });
      if (byNumber.results.length > 0) {
        return { ...byNumber, query };
      }
    } catch (error) {
      noteStageNetworkError(error);
      warnings.push(
        `Lookup por número: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const terms = searchTerms(query);
  if (terms.length === 0) {
    return {
      query,
      source: "legislacion",
      results: [],
      warnings: ["La consulta es demasiado corta o genérica."],
      searchUrls,
    };
  }

  // Mid-stage fetches use countFailure:"none"; one terminal count at the end.
  // 1) SPARQL AND on title terms
  let results: CitationResult[] = [];
  try {
    const data = await runSparql(
      buildTitleFilterSparql(terms, "and", limit),
      opts.signal,
      "none",
    );
    results = bindingsToResults(data.results.bindings, limit);
  } catch (error) {
    noteStageNetworkError(error);
    warnings.push(
      `SPARQL BCN: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 2) SPARQL OR (more permissive for natural language)
  if (!results.length && terms.length > 1) {
    try {
      const data = await runSparql(
        buildTitleFilterSparql(terms, "or", limit),
        opts.signal,
        "none",
      );
      results = bindingsToResults(data.results.bindings, Math.max(limit * 2, 12));
      const before = results.length;
      results = rankLegislacionResults(results, terms).slice(0, limit);
      if (results.length) {
        warnings.push(
          "Resultados SPARQL con coincidencia parcial (OR) en el título; filtrados por cobertura de términos — verifica relevancia.",
        );
      } else if (before > 0) {
        warnings.push(
          `SPARQL OR devolvió ${before} hit(s) pero ninguno cubría suficientes términos de la consulta.`,
        );
      }
    } catch (error) {
      noteStageNetworkError(error);
      warnings.push(
        `SPARQL OR: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 3) Single longest term
  if (!results.length && terms.length > 1) {
    const longest = [...terms].sort((a, b) => b.length - a.length)[0]!;
    try {
      const data = await runSparql(
        buildTitleFilterSparql([longest], "and", limit),
        opts.signal,
        "none",
      );
      results = bindingsToResults(data.results.bindings, limit);
      if (results.length) {
        warnings.push(
          `Resultados filtrados por el término «${longest}»; verifica relevancia.`,
        );
      }
    } catch (error) {
      noteStageNetworkError(error);
      warnings.push(
        `SPARQL término único: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 4) LeyChile HTML buscador (free public search)
  if (!results.length) {
    try {
      results = await searchLeyChileBuscador(query, limit, opts.signal, "none");
      if (results.length) {
        warnings.push(
          "Resultados desde el buscador web de LeyChile (metadata); confirma en la URL oficial.",
        );
      }
    } catch (error) {
      noteStageNetworkError(error);
      warnings.push(
        `Buscador LeyChile: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (!results.length) {
    warnings.push(
      "No se encontraron normas. Prueba el número de ley (p. ej. 19628) o un alias (Código del Trabajo).",
    );
    if (networkFailures > 0) {
      noteTerminalUpstreamFailure(SPARQL_ENDPOINT, lastNetworkStatus);
    }
  }

  return {
    query,
    source: "legislacion",
    results,
    searchUrls,
    warnings: warnings.length ? warnings : undefined,
  };
}

export async function getNorma(opts: {
  leychileCode?: string;
  number?: string;
  query?: string;
  signal?: AbortSignal;
  countFailure?: "terminal" | "none";
}): Promise<SearchResponse> {
  const countFailure = opts.countFailure ?? "terminal";
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

    const data = await runSparql(sparql, opts.signal, countFailure);
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

    const data = await runSparql(sparql, opts.signal, countFailure);
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
    return searchLegislacion(opts.query, 8, { signal: opts.signal });
  }

  return {
    query: "",
    source: "legislacion",
    results: [],
    warnings: ["Indica id_norma, numero o consulta."],
  };
}

export async function estadoNorma(
  idNorma: string,
  opts: { signal?: AbortSignal } = {},
): Promise<Record<string, unknown>> {
  const code = idNorma.replace(/\D/g, "");
  const meta = await getNorma({ leychileCode: code, signal: opts.signal });
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
  opts: { signal?: AbortSignal } = {},
): Promise<SearchResponse> {
  const code = idNorma.replace(/\D/g, "");
  // Query the explicit BCN relationship predicates (modifiesTo, isModifiedBy, recasts,
  // isRectifiedBy, isRegulatedBy, agreeWith) instead of a fuzzy title-similarity scan.
  // The fuzzy scan requires an unbound triple pattern over the whole graph and routinely
  // times out (>10s) against the public endpoint; the direct predicate lookup below
  // resolves in well under a second.
  const sparql = `
PREFIX bcnnorms: <http://datos.bcn.cl/ontologies/bcn-norms#>
PREFIX dc: <http://purl.org/dc/elements/1.1/>

SELECT DISTINCT ?rel ?norma ?title ?number ?date ?code
WHERE {
  ?ref bcnnorms:leychileCode ${code} .
  {
    ?ref bcnnorms:modifiesTo ?norma . BIND("modifica a" AS ?rel)
  } UNION {
    ?ref bcnnorms:isModifiedBy ?norma . BIND("modificada por" AS ?rel)
  } UNION {
    ?ref bcnnorms:recasts ?norma . BIND("refunde a" AS ?rel)
  } UNION {
    ?ref bcnnorms:isRectifiedBy ?norma . BIND("rectificada por" AS ?rel)
  } UNION {
    ?ref bcnnorms:isRegulatedBy ?norma . BIND("regulada por" AS ?rel)
  } UNION {
    ?ref bcnnorms:agreeWith ?norma . BIND("concuerda con" AS ?rel)
  }
  ?norma dc:title ?title .
  OPTIONAL { ?norma bcnnorms:hasNumber ?number }
  OPTIONAL { ?norma bcnnorms:publishDate ?date }
  OPTIONAL { ?norma bcnnorms:leychileCode ?code }
}
ORDER BY DESC(?date)
LIMIT 30
`.trim();

  try {
    const data = await runSparql(sparql, opts.signal);
    const results = bindingsToResults(data.results.bindings, 12);
    if (results.length === 0) {
      return {
        query: `relacionadas idNorma=${code}`,
        source: "legislacion",
        results: [],
        warnings: [
          "BCN no registra relaciones estructuradas (modifica/modificada por/refunde/etc.) para esta norma; revisa la historia oficial en LeyChile.",
        ],
        searchUrls: {
          historia: `https://www.bcn.cl/leychile/navegar?idNorma=${code}`,
        },
      };
    }
    return {
      query: `relacionadas idNorma=${code}`,
      source: "legislacion",
      results,
      warnings: [
        "Relaciones estructuradas de BCN (modifica/modificada por/refunde/rectificada por/regulada por/concuerda con); verifica en la historia oficial de la norma en LeyChile.",
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
        `No se pudieron obtener relaciones SPARQL: ${error instanceof Error ? error.message : String(error)}`,
        "Usa la historia oficial en LeyChile.",
      ],
      searchUrls: {
        historia: `https://www.bcn.cl/leychile/navegar?idNorma=${code}`,
      },
    };
  }
}

export type ReglamentoTipoHint =
  | "decreto_supremo"
  | "decreto"
  | "resolucion"
  | "reglamento"
  | "auto_acordado";

/**
 * Search secondary legislation through the same public BCN/LeyChile metadata
 * path as `buscar_legislacion`. The result remains candidate metadata until
 * the caller retrieves the official XML text.
 */
export async function searchReglamentos(
  query: string,
  limit = 8,
  opts: {
    signal?: AbortSignal;
    tipo?: ReglamentoTipoHint;
  } = {},
): Promise<SearchResponse> {
  const prefix =
    opts.tipo === "decreto_supremo"
      ? "decreto supremo"
      : opts.tipo === "decreto"
        ? "decreto"
        : opts.tipo === "resolucion"
          ? "resolucion"
          : opts.tipo === "reglamento"
            ? "reglamento"
            : opts.tipo === "auto_acordado"
              ? "auto acordado"
              : "decreto reglamento resolucion";
  const result = await searchLegislacion(`${prefix} ${query}`.trim(), limit, {
    signal: opts.signal,
  });
  return {
    ...result,
    query,
    warnings: [
      "Metadata BCN/LeyChile (candidate). Texto íntegro: obtener_articulo / citar_texto_legal con el idNorma.",
      ...(result.warnings ?? []),
    ],
    searchUrls: {
      ...(result.searchUrls ?? {}),
      reglamentos: `https://www.bcn.cl/leychile/consulta/buscador?termino=${encodeURIComponent(`${prefix} ${query}`.trim())}`,
    },
  };
}

export async function searchTratados(
  query: string,
  limit = 8,
  opts: {
    signal?: AbortSignal;
    ambito?: "ddhh" | "comercio" | "otro";
  } = {},
): Promise<SearchResponse> {
  const prefix =
    opts.ambito === "ddhh"
      ? "derechos humanos tratado convenio"
      : opts.ambito === "comercio"
        ? "comercio tratado convenio"
        : "tratado convenio pacto";
  const enriched =
    opts.ambito === "ddhh" &&
    !/derechos?\s*humanos|cidh|pidcp|cedaw/i.test(query)
      ? `${query} derechos humanos`
      : query;
  const result = await searchLegislacion(`${prefix} ${enriched}`.trim(), limit, {
    signal: opts.signal,
  });
  return {
    ...result,
    query,
    warnings: [
      "Tratado/convenio como metadata candidate. Confirma el texto promulgatorio y la fuente oficial antes de citar.",
      ...(result.warnings ?? []),
    ],
    searchUrls: {
      ...(result.searchUrls ?? {}),
      tratados: `https://www.bcn.cl/leychile/consulta/buscador?termino=${encodeURIComponent(`${prefix} ${enriched}`.trim())}`,
    },
  };
}
