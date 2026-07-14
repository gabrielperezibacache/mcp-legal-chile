import { throwIfAborted } from "../deadline.js";
import { webCache } from "../cache.js";
import { fetchJson } from "../util.js";

const TC_API = "https://buscador-backend.tcchile.cl/api/extended";
const TC_FICHA_API = "https://buscador-backend.tcchile.cl/api/buscadorexterno/ficha";
const TC_Buscador_UI = "https://buscador.tcchile.cl";
const TC_TIMEOUT_MS = Number(process.env.TC_TIMEOUT_MS ?? 10_000);

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

function filterParam(
  detalle: TcFichaDetalle[] | undefined,
  names: string[],
): string | undefined {
  const row = detalle?.find((d) =>
    names.some((n) => d.parametro?.nombre?.toLowerCase().includes(n.toLowerCase())),
  );
  if (!row) return undefined;
  if (row.valor) return row.valor.replace(/<[^>]+>/g, " ").trim();
  return row.detalle_multiple
    ?.map((m) => m.valor)
    .filter(Boolean)
    .join("; ");
}

export async function searchTcSentencias(
  query: string,
  limit = 5,
  signal?: AbortSignal,
): Promise<TcSearchHit[]> {
  throwIfAborted(signal);
  const key = `tc:search:${query}:${limit}`;
  return webCache.getOrSet(key, async () => {
    throwIfAborted(signal);
    const filter = encodeURIComponent(JSON.stringify({ search: query }));
    const data = await fetchJson<TcSearchResponse>(
      `${TC_API}/sentencias?filter=${filter}`,
      {},
      TC_TIMEOUT_MS,
      signal,
    );
    const rows = data.data?.results ?? [];
    return rows.slice(0, limit).map((r) => {
      const highlights =
        r.highlightParagraphs
          ?.map((h) => h.full ?? h.summary)
          .filter((x): x is string => Boolean(x)) ?? [];
      const excerpt =
        highlights.join(" ") ||
        r.content?.replace(/\s+/g, " ").trim().slice(0, 1200);
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
  votosMayoria?: string;
  articulosCpr?: string;
  fichaUrl: string;
  pdfUrl?: string;
}> {
  const key = `tc:ficha:${folioOrId}`;
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
      votosMayoria: filterParam(f.detalle, ["voto mayoría", "voto mayoria"]),
      articulosCpr: filterParam(f.detalle, ["artículo de la constitución", "articulo de la constitucion"]),
      fichaUrl: `${TC_Buscador_UI}/#/ficha/${folio}`,
      pdfUrl: f.exist_file ? `${TC_API}/${folio}/download` : undefined,
    };
  });
}

export function tcCitation(rol: string, competencia?: string): string {
  const comp = competencia ? ` (${competencia})` : "";
  return `Tribunal Constitucional, rol ${rol}${comp}`;
}

export function excerptForQuote(text: string, max = 3500): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}…`;
}
