import type { CitationResult, SearchResponse } from "../types.js";
import { uniqueByUrl } from "../util.js";
import {
  searchAgencySites,
  tryExtractAgencyBody,
  withAgencyExcerpt,
} from "./agencyWeb.js";

/** Ord. / dictamen DT numbers: "Ord. N° 1234/2020", "dictamen 2345". */
export function extractDtNumber(query: string): string | undefined {
  const ord = query.match(
    /(?:ord(?:enanza)?\.?|dictamen(?:es)?|n[ºo°.]?)\s*([0-9]{1,6}(?:\s*[-/]\s*[0-9]{2,4})?)/i,
  );
  return ord?.[1]?.replace(/\s+/g, "");
}

function dtPortalSearchUrl(numero: string): string {
  return `https://www.dt.gob.cl/portal/1626/w3-article-60314.html?numero=${encodeURIComponent(numero)}`;
}

const DT_PORTAL =
  "https://www.dt.gob.cl/portal/1626/w3-propertyvalue-23091.html";

export async function searchDictamenesDt(
  query: string,
  limit = 8,
  opts: { signal?: AbortSignal } = {},
): Promise<SearchResponse> {
  const warnings: string[] = [
    "DT: sin cuerpo HTML usable → evidence=link_only / integrity=candidate. Con extracto de ficha pública → verified (confirma íntegro en dt.gob.cl).",
  ];
  const results: CitationResult[] = [];
  const numero = extractDtNumber(query);

  if (numero) {
    const portal = dtPortalSearchUrl(numero);
    const ddgDeep = `https://duckduckgo.com/?q=${encodeURIComponent(
      `dictamen OR ord ${numero} site:dt.gob.cl`,
    )}`;
    const portalHit: CitationResult = {
      source: "dictamenes",
      title: `[Candidato · verificar] Ord./Dictamen DT N° ${numero}`,
      citation: `Ord./Dictamen DT N° ${numero} (enlace; texto no recuperado)`,
      url: portal,
      secondaryUrl: ddgDeep,
      publisher: "Dirección del Trabajo",
      id: numero,
      evidence: "link_only",
      summary:
        "NO es el texto del dictamen. Enlace/búsqueda al portal DT. Confirma existencia y texto íntegro antes de citar.",
      metadata: {
        integrity: "candidate",
        agency: "dt",
        portalGenerico: DT_PORTAL,
        busquedaSugerida: ddgDeep,
      },
    };
    const extracted = await tryExtractAgencyBody(portal, {
      label: "DT",
      anchors: /\b(?:dictamen|ordenanza|ord\.|dirección del trabajo)\b/i,
      timeoutMs: Number(process.env.DT_FETCH_TIMEOUT_MS ?? 10_000),
      signal: opts.signal,
    });
    if (extracted.warning) warnings.push(extracted.warning);
    if (extracted.excerpt) {
      results.push(
        withAgencyExcerpt(
          {
            ...portalHit,
            title:
              extracted.title ?? `Ord./Dictamen DT N° ${numero} — extracto`,
            citation: `Ord./Dictamen DT N° ${numero} (extracto HTML DT; verificar íntegro)`,
            summary: extracted.excerpt,
            url: DT_PORTAL,
            secondaryUrl: portal,
          },
          extracted.excerpt,
          "dt_html",
        ),
      );
    } else {
      results.push({ ...portalHit, url: DT_PORTAL, secondaryUrl: ddgDeep });
    }
  }

  const { results: webResults, warnings: webWarnings } =
    await searchAgencySites({
      query,
      limit,
      source: "dictamenes",
      searchQuery: numero
        ? `dictamen OR ord ${numero}`
        : `${query} dictamen OR ord`,
      sites: [
        { site: "dt.gob.cl", publisher: "Dirección del Trabajo" },
        { site: "dirtrab.cl", publisher: "Dirección del Trabajo" },
      ],
      signal: opts.signal,
      extract: {
        label: "DT",
        anchors: /\b(?:dictamen|ordenanza|ord\.|dirección del trabajo)\b/i,
        timeoutMs: Number(process.env.DT_FETCH_TIMEOUT_MS ?? 10_000),
        siteFilter: "dt.gob.cl",
        excerptSource: "dt_html",
      },
    });
  warnings.push(...webWarnings);
  for (const hit of webResults) {
    results.push({
      ...hit,
      metadata: { ...(hit.metadata ?? {}), agency: "dt" },
    });
  }

  const deduped = uniqueByUrl(results).slice(0, limit);
  if (deduped.length === 0) {
    warnings.push(
      "No se indexaron dictámenes DT automáticamente. Usa el buscador oficial de la Dirección del Trabajo.",
    );
  }

  return {
    query,
    source: "dictamenes",
    results: deduped,
    warnings,
    searchUrls: {
      dt: DT_PORTAL,
      busquedaSugerida: `https://duckduckgo.com/?q=${encodeURIComponent(
        `${query} dictamen site:dt.gob.cl`,
      )}`,
    },
  };
}

export async function resolverDictamenDt(
  numero: string,
): Promise<SearchResponse> {
  return searchDictamenesDt(`ord ${numero}`, 5);
}
