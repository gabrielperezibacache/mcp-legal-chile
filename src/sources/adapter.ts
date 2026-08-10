import type { SearchResponse } from "../types.js";
import { searchDictamenes } from "./dictamenes.js";
import { searchDictamenesDt } from "./dictamenesDt.js";
import { searchCmf, searchSernac } from "./regulatorios.js";

export type AdminSourceId = "dt" | "cgr" | "sernac" | "cmf";

/**
 * Thin adapter so new admin sources (DT/Sernac/CMF/CGR) plug into the pack
 * without rewriting the orchestrator.
 */
export interface SourceAdapter {
  id: AdminSourceId;
  kind: "dictamenes";
  label: string;
  search: (
    query: string,
    limit: number,
    opts?: { signal?: AbortSignal },
  ) => Promise<SearchResponse>;
}

export const dtAdapter: SourceAdapter = {
  id: "dt",
  kind: "dictamenes",
  label: "Dirección del Trabajo",
  search: searchDictamenesDt,
};

export const cgrAdapter: SourceAdapter = {
  id: "cgr",
  kind: "dictamenes",
  label: "Contraloría General de la República",
  search: searchDictamenes,
};

export const sernacAdapter: SourceAdapter = {
  id: "sernac",
  kind: "dictamenes",
  label: "SERNAC",
  search: searchSernac,
};

export const cmfAdapter: SourceAdapter = {
  id: "cmf",
  kind: "dictamenes",
  label: "Comisión para el Mercado Financiero",
  search: searchCmf,
};

const REGISTRY: Record<AdminSourceId, SourceAdapter> = {
  dt: dtAdapter,
  cgr: cgrAdapter,
  sernac: sernacAdapter,
  cmf: cmfAdapter,
};

export function getAdminAdapter(id: AdminSourceId): SourceAdapter {
  return REGISTRY[id];
}

export function listAdminAdapters(): SourceAdapter[] {
  return Object.values(REGISTRY);
}
