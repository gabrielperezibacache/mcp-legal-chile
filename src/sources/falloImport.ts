import { falloCache } from "../cache.js";
import {
  inferMetaFromPastedText,
  normalizeRol,
  parseCaseIdentifiers,
} from "../parsers.js";
import {
  fetchText,
  stripHtml,
  WEB_SEARCH_USER_AGENT,
} from "../util.js";
import {
  parseConsiderandos,
  type Considerando,
} from "./considerandos.js";

export interface CachedFallo {
  rol: string;
  texto: string;
  tribunal?: string;
  tipoResolucion?: string;
  anio?: string;
  url?: string;
  source: "texto_pegado" | "url_html";
  importedAt: number;
  considerandos: Array<{ numero?: number; label: string }>;
}

function falloCacheKey(rol: string): string {
  return `fallo:${normalizeRol(rol).display.toLowerCase()}`;
}

export function getCachedFallo(rol: string): CachedFallo | undefined {
  return falloCache.get<CachedFallo>(falloCacheKey(rol));
}

export function setCachedFallo(entry: CachedFallo): CachedFallo {
  return falloCache.set(falloCacheKey(entry.rol), entry);
}

function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|#|$)/i.test(url) || /\/pdf\//i.test(url);
}

function looksLikePdfBody(body: string): boolean {
  return body.startsWith("%PDF") || body.includes("%PDF-");
}

/** Best-effort plain text from a public HTML judgment page. */
export async function fetchJudgmentTextFromUrl(
  url: string,
  signal?: AbortSignal,
): Promise<{ texto: string; warnings: string[] }> {
  const warnings: string[] = [];
  if (isPdfUrl(url)) {
    throw new Error(
      "La URL apunta a un PDF. Este MCP no extrae texto de PDF sin librerías de pago/locales: abre el PDF, copia el texto y usa importar_fallo con `texto`, o citar_jurisprudencia.",
    );
  }
  const raw = await fetchText(
    url,
    {
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent": WEB_SEARCH_USER_AGENT,
      },
    },
    Number(process.env.FALLO_FETCH_TIMEOUT_MS ?? 15_000),
    signal,
  );
  if (looksLikePdfBody(raw)) {
    throw new Error(
      "La URL devolvió un PDF binario. Copia el texto del fallo y pégalo en importar_fallo / citar_jurisprudencia.",
    );
  }
  const texto = stripHtml(raw).replace(/\s+/g, " ").trim();
  if (texto.length < 120) {
    throw new Error(
      "No se pudo extraer texto útil desde la URL (página vacía, login o JS-only). Pega el texto del fallo manualmente.",
    );
  }
  warnings.push(
    "Texto extraído desde HTML público; contrasta con el PDF/portal oficial antes de citar.",
  );
  return { texto, warnings };
}

export interface ImportarFalloResult {
  rol: string;
  tribunal?: string;
  tipoResolucion?: string;
  anio?: string;
  url?: string;
  source: CachedFallo["source"];
  evidence: "full_text";
  integrity: "verified";
  considerandos: Array<{ numero?: number; label: string }>;
  considerandosCount: number;
  textoLength: number;
  cached: boolean;
  warnings: string[];
  markdown: string;
  texto: string;
}

function summarizeConsiderandos(
  items: Considerando[],
): CachedFallo["considerandos"] {
  return items.slice(0, 80).map((c) => ({
    numero: c.numero,
    label: c.label,
  }));
}

/**
 * Import a judgment (pasted text or public HTML URL), parse considerandos, cache by ROL.
 */
export async function importarFallo(opts: {
  rol: string;
  texto?: string;
  url?: string;
  tribunal?: string;
  tipoResolucion?: string;
  anio?: string;
  signal?: AbortSignal;
}): Promise<ImportarFalloResult> {
  const norm = normalizeRol(opts.rol);
  if (!norm.numero) {
    throw new Error("Indica un ROL válido (ej. 12345-2020).");
  }

  const warnings: string[] = [];
  let texto = opts.texto?.trim() ?? "";
  let source: CachedFallo["source"] = "texto_pegado";
  const url = opts.url?.trim() || undefined;

  if (!texto && url) {
    const fetched = await fetchJudgmentTextFromUrl(url, opts.signal);
    texto = fetched.texto;
    warnings.push(...fetched.warnings);
    source = "url_html";
  }

  if (!texto) {
    throw new Error(
      "Indica `texto` (fallo pegado) o `url` HTML pública. Para PDF: copia el texto y pégalo.",
    );
  }
  if (texto.length < 80) {
    throw new Error(
      "El texto es demasiado corto. Pega el fallo o al menos la sección de considerandos.",
    );
  }

  const inferred = inferMetaFromPastedText(texto);
  const ids = parseCaseIdentifiers(texto.slice(0, 2_000));
  const tribunal =
    opts.tribunal?.trim() || inferred.tribunal || ids.tribunal || undefined;
  const tipoResolucion =
    opts.tipoResolucion?.trim() ||
    inferred.tipoResolucion ||
    ids.tipo ||
    "Sentencia";
  const anio =
    opts.anio?.trim() ||
    inferred.anio ||
    ids.anio ||
    (norm.anio || undefined);

  const parsed = parseConsiderandos(texto);
  const considerandos = summarizeConsiderandos(parsed);
  if (parsed.length === 0) {
    warnings.push(
      "No se detectaron considerandos numerados; igual se cachea el texto para citar_jurisprudencia.",
    );
  }

  const entry: CachedFallo = {
    rol: norm.display,
    texto,
    tribunal,
    tipoResolucion,
    anio,
    url,
    source,
    importedAt: Date.now(),
    considerandos,
  };
  setCachedFallo(entry);

  const markdown = [
    `## Fallo importado — ROL \`${norm.display}\``,
    "",
    `- **Integridad:** \`verified\` — texto aportado/extraído (no inventado)`,
    `- **Evidencia:** \`full_text\``,
    `- **Origen:** ${source === "url_html" ? "HTML público" : "texto pegado"}`,
    tribunal ? `- **Tribunal:** ${tribunal}` : null,
    `- **Tipo:** ${tipoResolucion}`,
    anio ? `- **Año:** ${anio}` : null,
    url ? `- **URL:** ${url}` : null,
    `- **Caracteres:** ${texto.length}`,
    `- **Considerandos detectados:** ${parsed.length}`,
    `- **Cache:** listo para \`citar_jurisprudencia\` con este ROL (sin volver a pegar)`,
    "",
    parsed.length
      ? [
          "### Índice de considerandos (muestra)",
          "",
          ...considerandos.slice(0, 25).map((c) => {
            const n = c.numero != null ? `${c.numero}` : "?";
            return `- **${n}** — ${c.label}`;
          }),
          parsed.length > 25 ? `- _…y ${parsed.length - 25} más_` : null,
          "",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    "→ Siguiente: `citar_jurisprudencia` con el mismo `rol` (usa cache) o indica `considerando` / `consulta`.",
    "",
    warnings.length
      ? ["### Advertencias", ...warnings.map((w) => `- ${w}`)].join("\n")
      : "",
  ]
    .filter((line) => line !== null)
    .join("\n");

  return {
    rol: norm.display,
    tribunal,
    tipoResolucion,
    anio,
    url,
    source,
    evidence: "full_text",
    integrity: "verified",
    considerandos,
    considerandosCount: parsed.length,
    textoLength: texto.length,
    cached: true,
    warnings,
    markdown,
    texto,
  };
}
