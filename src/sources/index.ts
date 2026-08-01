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
import { searchAdministrativo } from "./administrativo.js";
import {
  obtenerFalloTc,
  resolverRol,
  resolveRolToMarkdown,
  searchJurisprudencia,
  searchTribunalConstitucional,
} from "./jurisprudencia.js";
import { searchLegislacion } from "./legislacion.js";
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
  buscarCausaPjud,
  obtenerCausaPjud,
  PJUD_CAUSAS_PORTAL_URL,
  PjudCausasCaptchaError,
  PjudCausasNoResultsError,
  PjudCausasSolverBudgetError,
  PjudCausasTimeoutError,
  type BuscarCausaTipoPersona,
} from "./pjudCauses.js";
export {
  citarDictamenPegado,
  type DictamenQuote,
} from "./dictamenQuote.js";

export {
  citarJurisprudencia,
  citarTextoLegal,
  investigarTema,
  obtenerFalloTc,
  resolverDictamen,
  resolverRol,
  resolveRolToMarkdown,
  searchAdministrativo,
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
  parentSignal?: AbortSignal,
): Promise<SearchResponse> {
  const started = Date.now();
  const pendingSources: string[] = [];
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener("abort", onParentAbort);
  if (parentSignal?.aborted) controller.abort();
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
    const [legislacion, jurisprudencia, doctrina, dictamenes, administrativo] =
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
        run("administrativo", (signal) =>
          searchAdministrativo(query, limitPerSource, { signal }),
        ),
      ]);

    const responses = [
      legislacion,
      jurisprudencia,
      doctrina,
      dictamenes,
      administrativo,
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
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}
