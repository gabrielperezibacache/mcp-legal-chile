import { formatChileanCitation } from "../citation.js";
import { throwIfAborted } from "../deadline.js";
import { webCache } from "../cache.js";
import { fetchJson } from "../util.js";

const TC_API = "https://buscador-backend.tcchile.cl/api/extended";
const TC_FICHA_API =
  "https://buscador-backend.tcchile.cl/api/buscadorexterno/ficha";
const TC_Buscador_UI = "https://buscador.tcchile.cl";
/** TC keyword search often takes 6–14s; keep under SEARCH_TOOL_TIMEOUT_MS. */
const TC_TIMEOUT_MS = Number(process.env.TC_TIMEOUT_MS ?? 18_000);

const TC_STOPWORDS = new Set([
  "a",
  "al",
  "ante",
  "bajo",
  "como",
  "con",
  "contra",
  "de",
  "del",
  "desde",
  "durante",
  "el",
  "en",
  "entre",
  "hacia",
  "hasta",
  "la",
  "las",
  "lo",
  "los",
  "mas",
  "más",
  "mediante",
  "ni",
  "no",
  "o",
  "para",
  "por",
  "que",
  "se",
  "segun",
  "según",
  "sin",
  "so",
  "sobre",
  "su",
  "sus",
  "tras",
  "un",
  "una",
  "unos",
  "unas",
  "y",
  "ya",
]);

export interface TcSearchHit {
  id: string;
  rol: string;
  sentenceId?: string;
  competencia?: string;
  competenciaShort?: string;
  excerpt?: string;
  highlights?: string[];
  content?: string;
  pdfUrl: string;
  fichaUrl: string;
}

interface TcSearchResponse {
  data?: {
    count?: number;
    results?: Array<{
      id: string;
      rol: string;
      sentence_id?: number;
      competencia?: string;
      competenciaShortName?: string;
      content?: string;
      highlightParagraphs?: Array<{ full?: string; summary?: string }>;
    }>;
  };
}

interface TcFichaDetalle {
  parametro?: { nombre?: string; codigo?: string };
  valor?: string;
  detalle_multiple?: Array<{ valor?: string }>;
}

interface TcFichaResponse {
  data?: {
    id?: number;
    folio?: string;
    nombre?: string;
    fecha_sentencia?: string;
    template?: { complete_name?: string };
    detalle?: TcFichaDetalle[];
    exist_file?: number;
  };
}

/**
 * TC free-text search ANDs every token, including stopwords like "a"/"la",
 * which yields empty results for phrases such as "derecho a la vida".
 */
export function normalizeTcSearchQuery(query: string): string {
  const raw = query.normalize("NFC").trim();
  if (!raw) return raw;
  const tokens = raw
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const kept = tokens.filter((t) => {
    const lower = t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    const foldedStop =
      TC_STOPWORDS.has(lower) || TC_STOPWORDS.has(t.toLowerCase());
    return lower.length > 1 && !foldedStop;
  });
  if (kept.length > 0) return kept.join(" ");
  return tokens.join(" ") || raw;
}

function buildTcSearchFilter(
  search: string,
  opts: {
    competencia?: string;
    tipoResolucion?: string;
    articuloConstitucion?: string;
  } = {},
): Record<string, unknown> {
  return {
    folio: "",
    fecha_sentencia: null,
    search,
    tipo_resolucion: opts.tipoResolucion?.trim() || null,
    resultado: null,
    competencia: opts.competencia?.trim() || null,
    articulo_constitucion: opts.articuloConstitucion?.trim() || null,
    ministro: null,
    cuerpo_legal: null,
    palabra_clave: null,
  };
}

function filterParam(
  detalle: TcFichaDetalle[] | undefined,
  names: string[],
): string | undefined {
  const row = detalle?.find((d) =>
    names.some((n) =>
      d.parametro?.nombre?.toLowerCase().includes(n.toLowerCase()),
    ),
  );
  if (!row) return undefined;
  if (row.valor) return row.valor.replace(/<[^>]+>/g, " ").trim();
  return row.detalle_multiple
    ?.map((m) => m.valor)
    .filter(Boolean)
    .join("; ");
}

function hitMatchesYear(
  hit: { rol: string; content?: string },
  anio: string,
): boolean {
  const y = anio.trim();
  if (!/^(19|20)\d{2}$/.test(y)) return true;
  const short = y.slice(-2);
  const hay = `${hit.rol} ${hit.content ?? ""}`;
  return (
    hay.includes(y) ||
    hit.rol.includes(`-${short}`) ||
    hit.rol.endsWith(`-${short}`) ||
    new RegExp(`-${short}(?:-|$)`).test(hit.rol)
  );
}

export async function searchTcSentencias(
  query: string,
  limit = 5,
  signal?: AbortSignal,
  opts: {
    anio?: string;
    competencia?: string;
    tipoResolucion?: string;
    articuloConstitucion?: string;
  } = {},
): Promise<TcSearchHit[]> {
  throwIfAborted(signal);
  const search = normalizeTcSearchQuery(query);
  if (!search) return [];
  const anio = opts.anio?.trim();
  const key = `tc:search:v4:${search}:${limit}:${anio ?? ""}:${opts.competencia ?? ""}:${opts.tipoResolucion ?? ""}:${opts.articuloConstitucion ?? ""}`;
  return webCache.getOrSet(key, async () => {
    throwIfAborted(signal);
    const filter = encodeURIComponent(
      JSON.stringify(
        buildTcSearchFilter(search, {
          competencia: opts.competencia,
          tipoResolucion: opts.tipoResolucion,
          articuloConstitucion: opts.articuloConstitucion,
        }),
      ),
    );
    const data = await fetchJson<TcSearchResponse>(
      `${TC_API}/sentencias?filter=${filter}`,
      {},
      TC_TIMEOUT_MS,
      signal,
    );
    let rows = data.data?.results ?? [];
    if (anio) {
      const filtered = rows.filter((r) =>
        hitMatchesYear({ rol: String(r.rol), content: r.content }, anio),
      );
      // Keep unfiltered only if year wiped everything (API may omit year in ROL).
      if (filtered.length) rows = filtered;
    }
    return rows.slice(0, limit).map((r) => {
      const highlights =
        r.highlightParagraphs
          ?.map((h) => h.full ?? h.summary)
          .filter((x): x is string => Boolean(x)) ?? [];
      const excerpt =
        highlights.join(" ") ||
        r.content?.replace(/\s+/g, " ").trim().slice(0, 3_000);
      return {
        id: String(r.id),
        rol: String(r.rol),
        sentenceId: r.sentence_id ? String(r.sentence_id) : undefined,
        competencia: r.competencia,
        competenciaShort: r.competenciaShortName,
        excerpt,
        highlights,
        content: r.content,
        pdfUrl: `${TC_API}/${r.id}/download`,
        fichaUrl: `${TC_Buscador_UI}/#/ficha/${r.rol}`,
      };
    });
  });
}

export async function getTcFicha(
  folioOrId: string,
  signal?: AbortSignal,
): Promise<{
  folio: string;
  fecha?: string;
  competencia?: string;
  gestion?: string;
  resultado?: string;
  doctrina?: string;
  tipoResolucion?: string;
  votosMayoria?: string;
  articulosCpr?: string;
  fichaUrl: string;
  pdfUrl?: string;
}> {
  const key = `tc:ficha:v2:${folioOrId}`;
  return webCache.getOrSet(key, async () => {
    throwIfAborted(signal);
    const data = await fetchJson<TcFichaResponse>(
      `${TC_FICHA_API}/${encodeURIComponent(folioOrId)}`,
      {},
      TC_TIMEOUT_MS,
      signal,
    );
    const f = data.data;
    if (!f?.folio) {
      throw new Error(`TC no devolvió ficha para ${folioOrId}`);
    }
    const folio = String(f.folio);
    return {
      folio,
      fecha: f.fecha_sentencia?.slice(0, 10),
      competencia: f.template?.complete_name ?? f.nombre,
      gestion: filterParam(f.detalle, ["gestión", "gestion"]),
      resultado: filterParam(f.detalle, ["resultado"]),
      doctrina: filterParam(f.detalle, ["doctrina"]),
      tipoResolucion: filterParam(f.detalle, [
        "tipo de resolución",
        "tipo de resolucion",
      ]),
      votosMayoria: filterParam(f.detalle, ["voto mayoría", "voto mayoria"]),
      articulosCpr: filterParam(f.detalle, [
        "artículo de la constitución",
        "articulo de la constitucion",
      ]),
      fichaUrl: `${TC_Buscador_UI}/#/ficha/${folio}`,
      pdfUrl: f.exist_file ? `${TC_API}/${folio}/download` : undefined,
    };
  });
}

export function tcCitation(
  rol: string,
  competenciaOrOpts?:
    | string
    | {
        competencia?: string;
        tipoResolucion?: string;
        anio?: string;
        considerando?: string;
      },
): string {
  if (typeof competenciaOrOpts === "string" || competenciaOrOpts == null) {
    return (
      formatChileanCitation({
        tribunal: "Tribunal Constitucional",
        tipo: "Sentencia",
        rol,
      }).citation + (competenciaOrOpts ? ` (${competenciaOrOpts})` : "")
    );
  }
  return formatChileanCitation({
    tribunal: "Tribunal Constitucional",
    tipo: competenciaOrOpts.tipoResolucion ?? "Sentencia",
    rol,
    anio: competenciaOrOpts.anio,
    considerando: competenciaOrOpts.considerando,
  }).citation;
}

export function excerptForQuote(text: string, max = 3500): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}…`;
}
