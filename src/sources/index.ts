import type { SearchResponse } from "../types.js";
export {
  doctrineToMarkdown,
  obtenerDoctrina,
  searchDoctrina,
} from "./doctrina.js";
import { searchDoctrina } from "./doctrina.js";
import { searchDictamenes, resolverDictamen } from "./dictamenes.js";
import {
  searchJurisprudencia,
  searchTribunalConstitucional,
} from "./jurisprudencia.js";
import {
  estadoNorma,
  getNorma,
  normasRelacionadas,
  searchLegislacion,
} from "./legislacion.js";
import { citarTextoLegal } from "./legalQuote.js";
import { investigarTema } from "./research.js";

export {
  citarTextoLegal,
  estadoNorma,
  getNorma,
  investigarTema,
  normasRelacionadas,
  resolverDictamen,
  searchDictamenes,
  searchJurisprudencia,
  searchLegislacion,
  searchTribunalConstitucional,
};

export {
  findArticulo,
  findIncisoOrLiteral,
  normaToPlainText,
  parseNormaTexto,
} from "./normaTexto.js";

export async function searchTodas(
  query: string,
  limitPerSource = 4,
  budgetMs = Number(process.env.UNIFIED_BUDGET_MS ?? 8000),
): Promise<SearchResponse> {
  const started = Date.now();
  const pendingSources: string[] = [];

  const run = async <T>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<T | null> => {
    const remaining = budgetMs - (Date.now() - started);
    if (remaining < 200) {
      pendingSources.push(label);
      return null;
    }
    try {
      return await Promise.race([
        fn(),
        new Promise<null>((resolve) =>
          setTimeout(() => {
            pendingSources.push(`${label} (timeout)`);
            resolve(null);
          }, remaining),
        ),
      ]);
    } catch (error) {
      pendingSources.push(
        `${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  };

  const [legislacion, jurisprudencia, doctrina, dictamenes] = await Promise.all([
    run("legislacion", () => searchLegislacion(query, limitPerSource)),
    run("jurisprudencia", () => searchJurisprudencia(query, limitPerSource)),
    run("doctrina", () => searchDoctrina(query, limitPerSource)),
    run("dictamenes", () => searchDictamenes(query, limitPerSource)),
  ]);

  const responses = [legislacion, jurisprudencia, doctrina, dictamenes].filter(
    (r): r is SearchResponse => r != null,
  );

  return {
    query,
    source: "todas",
    results: responses.flatMap((r) => r.results),
    warnings: responses.flatMap((r) => r.warnings ?? []),
    pendingSources: pendingSources.length ? pendingSources : undefined,
    searchUrls: Object.assign(
      {},
      ...responses.map((r) => r.searchUrls ?? {}),
    ),
  };
}
