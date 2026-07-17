import type { SearchResponse } from "../types.js";
export {
  doctrineToMarkdown,
  formatDoctrineSearchMarkdown,
  obtenerDoctrina,
  searchDoctrina,
  searchDoctrinaLatam,
} from "./doctrina.js";
import { searchDoctrina } from "./doctrina.js";
import { searchDictamenes, resolverDictamen } from "./dictamenes.js";
import {
  obtenerFalloTc,
  resolverRol,
  resolveRolToMarkdown,
  searchJurisprudencia,
  searchTribunalConstitucional,
} from "./jurisprudencia.js";
import {
  searchLegislacion,
} from "./legislacion.js";
export {
  estadoNorma,
  getNorma,
  normasRelacionadas,
  parseLeyChileBuscadorHtml,
  searchLegislacion,
} from "./legislacion.js";
import { citarJurisprudencia } from "./jurisQuote.js";
import { citarTextoLegal } from "./legalQuote.js";
import { investigarTema } from "./research.js";
import { remainingMs, runWithDeadline } from "../deadline.js";

export {
  citarJurisprudencia,
  citarTextoLegal,
  investigarTema,
  obtenerFalloTc,
  resolverDictamen,
  resolverRol,
  resolveRolToMarkdown,
  searchDictamenes,
  searchJurisprudencia,
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);

  const run = async <T>(
    label: string,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | null> => {
    const remaining = remainingMs(started, budgetMs);
    if (remaining < 200) {
      pendingSources.push(label);
      return null;
    }
    try {
      return await runWithDeadline(label, remaining, fn, controller.signal);
    } catch (error) {
      pendingSources.push(
        `${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  };

  try {
    const [legislacion, jurisprudencia, doctrina, dictamenes] =
      await Promise.all([
        run("legislacion", (signal) =>
          searchLegislacion(query, limitPerSource, { signal }),
        ),
        run("jurisprudencia", (signal) =>
          searchJurisprudencia(query, limitPerSource, { signal }),
        ),
        run("doctrina", (signal) =>
          searchDoctrina(query, limitPerSource, { signal, fast: true }),
        ),
        run("dictamenes", (signal) =>
          searchDictamenes(query, limitPerSource, { signal }),
        ),
      ]);

    const responses = [
      legislacion,
      jurisprudencia,
      doctrina,
      dictamenes,
    ].filter((r): r is SearchResponse => r != null);

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
  } finally {
    clearTimeout(timer);
  }
}
