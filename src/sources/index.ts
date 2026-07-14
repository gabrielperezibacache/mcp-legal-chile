import type { SearchResponse } from "../types.js";
import { searchDictamenes } from "./dictamenes.js";
import { searchDoctrina } from "./doctrina.js";
import { searchJurisprudencia } from "./jurisprudencia.js";
import { getNorma, searchLegislacion } from "./legislacion.js";

export {
  getNorma,
  searchDictamenes,
  searchDoctrina,
  searchJurisprudencia,
  searchLegislacion,
};

export async function searchTodas(
  query: string,
  limitPerSource = 4,
): Promise<SearchResponse> {
  const [legislacion, jurisprudencia, doctrina, dictamenes] =
    await Promise.allSettled([
      searchLegislacion(query, limitPerSource),
      searchJurisprudencia(query, limitPerSource),
      searchDoctrina(query, limitPerSource),
      searchDictamenes(query, limitPerSource),
    ]);

  const responses = [legislacion, jurisprudencia, doctrina, dictamenes]
    .filter(
      (r): r is PromiseFulfilledResult<SearchResponse> =>
        r.status === "fulfilled",
    )
    .map((r) => r.value);

  const warnings = [
    ...responses.flatMap((r) => r.warnings ?? []),
    ...[legislacion, jurisprudencia, doctrina, dictamenes]
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => `Fuente falló: ${String(r.reason)}`),
  ];

  return {
    query,
    source: "todas",
    results: responses.flatMap((r) => r.results),
    warnings: warnings.length ? warnings : undefined,
    searchUrls: Object.assign(
      {},
      ...responses.map((r) => r.searchUrls ?? {}),
    ),
  };
}
