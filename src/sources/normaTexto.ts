import { XMLParser } from "fast-xml-parser";
import { xmlCache } from "../cache.js";
import { numberToOrdinalWords, ordinalWordsToNumber } from "./considerandos.js";
import { fetchTextWithRetry, HttpStatusError } from "../util.js";

/** Normalize inciso labels so "1" / "1º" / "primero" match. */
function normalizeIncisoKey(label: string): string {
  const raw = label.replace(/[º°]/g, "").trim().toLowerCase();
  if (/^\d{1,3}$/.test(raw)) return raw;
  const fromWords = ordinalWordsToNumber(raw);
  if (fromWords != null) return String(fromWords);
  return raw;
}

function incisoLabelsMatch(a: string, b: string): boolean {
  const ka = normalizeIncisoKey(a);
  const kb = normalizeIncisoKey(b);
  if (ka === kb) return true;
  // Also accept word form of a numeric label (and vice versa).
  const na = Number(ka);
  const nb = Number(kb);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  if (Number.isFinite(na)) {
    const words = numberToOrdinalWords(na);
    if (words && normalizeIncisoKey(words) === kb) return true;
  }
  if (Number.isFinite(nb)) {
    const words = numberToOrdinalWords(nb);
    if (words && normalizeIncisoKey(words) === ka) return true;
  }
  return false;
}

const NS_STRIP = /\{[^}]+\}/g;

/** Short negative cache so a 429 does not hammer LeyChile for the same idNorma. */
const XML_429_CACHE_MS = Number(process.env.LEYCHILE_429_CACHE_MS ?? 60_000);
const xml429Until = new Map<string, number>();

export class LeyChileRateLimitError extends Error {
  idNorma: string;
  retryAfterMs: number;
  constructor(idNorma: string, retryAfterMs: number) {
    super(
      `LeyChile rate-limit (429) para idNorma=${idNorma}. Reintenta en ~${Math.ceil(retryAfterMs / 1000)}s.`,
    );
    this.name = "LeyChileRateLimitError";
    this.idNorma = idNorma;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface NormaPart {
  tipo: string;
  idParte?: string;
  titulo?: string;
  /** Raw <NombreParte> metadata, e.g. "58 bis" or "12 (DEL ART. 2)". Used as
   * a fallback article-number source when the body text uses the abbreviated
   * "Art. N.-" form instead of the full "Artículo N.-" that
   * normalizeArticleNumber expects. */
  nombreParte?: string;
  texto: string;
  derogado?: string;
  children: NormaPart[];
}

export interface NormaTexto {
  idNorma: string;
  titulo: string;
  tipo?: string;
  numero?: string;
  fechaPublicacion?: string;
  fechaVersion?: string;
  derogado?: string;
  materias: string[];
  organismos: string[];
  url: string;
  xmlUrl: string;
  partes: NormaPart[];
  articulos: Array<{
    numero: string;
    idParte?: string;
    texto: string;
    url: string;
    incisos: Array<{ label: string; texto: string }>;
    literales: Array<{ letra: string; texto: string }>;
  }>;
}

export class LeyChileXmlError extends Error {
  constructor(idNorma: string, detail: string) {
    super(
      `LeyChile XML inválido/no disponible para idNorma=${idNorma}: ${detail}`,
    );
    this.name = "LeyChileXmlError";
  }
}

export class ArticleNotFoundError extends Error {
  requested: string;
  available: string[];

  constructor(norma: NormaTexto, requested: string) {
    const available = availableArticleNumbers(norma);
    const sample =
      available.length > 0
        ? available.slice(0, 40).join(", ")
        : "ningún artículo detectado";
    super(
      `Artículo no encontrado: ${requested} (idNorma=${norma.idNorma}). Artículos disponibles: ${sample}`,
    );
    this.name = "ArticleNotFoundError";
    this.requested = requested;
    this.available = available;
  }
}

export class UnsupportedNormaStructureError extends Error {
  constructor(idNorma: string, reason: string) {
    super(
      `Formato no soportado para idNorma=${idNorma}: ${reason}. Usa el enlace oficial LeyChile para verificar manualmente.`,
    );
    this.name = "UnsupportedNormaStructureError";
  }
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object" && node !== null && "#text" in node) {
    return String((node as { "#text": unknown })["#text"] ?? "");
  }
  return "";
}

function decodeEntitiesOnly(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) =>
      String.fromCharCode(Number.parseInt(n, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
      String.fromCharCode(Number.parseInt(h, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * LeyChile XML <Texto> is fixed-width plain text: each real paragraph
 * (inciso) starts on its own line indented ~5 spaces, while wrapped
 * continuation lines of the same paragraph start at column 0. Marginal
 * annotations (amendment history like "LEY N° 19.611 Art. único") are
 * interleaved to the right of the main column and get pulled onto their
 * own 0-indent lines too, so this signal is noisy but still the only
 * reliable paragraph-boundary marker LeyChile gives us. We insert a
 * paragraph-break marker (\n\n) before each ~5-space-indented line *before*
 * collapsing whitespace, so parseIncisosAndLiterales's fallback split can
 * still find inciso boundaries after normalization. Without this, collapsing
 * "\s+" to a single space first (as before) destroyed every paragraph break,
 * silently leaving `obtener_inciso` unable to find any inciso beyond
 * explicitly-labelled "Inciso segundo.-" headings (rare in practice).
 */
function markParagraphBreaks(text: string): string {
  return text.replace(/\n {4,7}(?=\S)/g, "\n\n     ");
}

/** Exported for unit testing; also used internally by parsePart. */
export function decodeEntities(text: string): string {
  const marked = decodeEntitiesOnly(markParagraphBreaks(text));
  // Join wrapped continuation lines back into their paragraph (single \n →
  // space) while keeping genuine paragraph breaks (the \n\n inserted above,
  // or any blank line already present in the source) intact.
  // Use a Private Use Area codepoint (never appears in real LeyChile text) as
  // a paragraph-break sentinel instead of a literal control character, which
  // eslint's no-control-regex rule (rightly) flags as suspicious.
  const PARA_SENTINEL = "\uE000PARA\uE000";
  return marked
    .replace(/\n{2,}/g, PARA_SENTINEL)
    .replace(/\s*\n\s*/g, " ")
    .replace(new RegExp(PARA_SENTINEL, "g"), "\n\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n\n */g, "\n\n")
    .trim();
}

/** Exported for unit testing; also used internally by flattenArticles. */
export function normalizeArticleNumber(texto: string): string | undefined {
  // Anchor to the very start of the (already-trimmed) article body so that
  // in-body cross references ("... prevenido en el artículo 124 ...") are
  // never mistaken for the article's own heading/number. Accepts both the
  // full "Artículo" and the abbreviated "Art." forms LeyChile mixes freely.
  const match = texto.match(
    /^art(?:[ií]culo|\.)\s*([0-9]+(?:\s*(?:bis|ter|qu[aá]ter|quinquies))?(?:º|°)?)/i,
  );
  if (!match) return undefined;
  return match[1].replace(/\s+/g, " ").replace(/[º°]/g, "").trim();
}

/** Extracts the leading numeric/bis-ter token from a <NombreParte> value
 * like "58 bis" or "12 (DEL ART. 2)", stripping the "(DEL ART. N)" suffix
 * that LeyChile appends when an article was inserted via a "Doble
 * Articulado" (a law's own art. 2 introducing a new codified text). */
export function normalizeFromNombreParte(
  nombreParte: string,
): string | undefined {
  const match = nombreParte.match(
    /^\s*([0-9]+(?:\s*(?:bis|ter|qu[aá]ter|quinquies))?)/i,
  );
  if (!match) return undefined;
  return match[1].replace(/\s+/g, " ").trim();
}

function normalizeArticleKey(texto: string): string {
  return texto
    .toLowerCase()
    .replace(/art[ií]culo/gi, "")
    .replace(/[º°]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function parsePart(node: Record<string, unknown>): NormaPart {
  const meta = (node.Metadatos ?? {}) as Record<string, unknown>;
  const children = asArray(node.EstructurasFuncionales).flatMap((block) => {
    const b = block as Record<string, unknown>;
    return asArray(b.EstructuraFuncional).map((child) =>
      parsePart(child as Record<string, unknown>),
    );
  });

  return {
    // tipoParte is an XML attribute, so entities like "Art&#237;culo" are
    // never decoded by the parser's text-node handling — decode explicitly
    // or flattenArticles's /art[ií]culo/i.test(part.tipo) silently never
    // matches and every article is misclassified.
    tipo: decodeEntitiesOnly(String(node["@_tipoParte"] ?? "")),
    idParte: node["@_idParte"] ? String(node["@_idParte"]) : undefined,
    nombreParte: decodeEntities(textOf(meta.NombreParte)) || undefined,
    titulo: decodeEntities(textOf(meta.TituloParte)),
    texto: decodeEntities(textOf(node.Texto)),
    derogado: node["@_derogado"] ? String(node["@_derogado"]) : undefined,
    children,
  };
}

/** Exported for unit testing; also used internally by flattenArticles. */
export function parseIncisosAndLiterales(texto: string): {
  incisos: Array<{ label: string; texto: string }>;
  literales: Array<{ letra: string; texto: string }>;
} {
  const literales: Array<{ letra: string; texto: string }> = [];
  const litRe =
    /(?:^|[;.\s])([a-z]|[a-z]\))[).\-–—]\s*([^;]+?)(?=(?:[;.]\s*[a-z][).\-–—])|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = litRe.exec(texto)) !== null) {
    const letra = m[1].replace(")", "");
    const body = m[2].trim();
    if (body.length > 8) literales.push({ letra, texto: body });
  }

  const incisos: Array<{ label: string; texto: string }> = [];
  // Only treat "Inciso X" as a structural heading when it starts a sentence
  // (start-of-string, after ".-"/"." + whitespace, or a newline) and is
  // immediately followed by ordinal/number punctuation like ".-" or ":".
  // Plain in-body cross references ("... a que se refiere el inciso
  // precedente", "... el inciso se elevará al doble ...") must NOT split,
  // or every article mentioning a prior inciso gets shredded into bogus
  // "incisos" like {label:"precedente"} or {label:"se"}.
  const incisoHeadingRe =
    /(?:^|[.\-–—]\s+|\n\s*)(Inciso\s+(?:[Pp]rimero|[Ss]egundo|[Tt]ercero|[Cc]uarto|[Qq]uinto|[Ss]exto|[Ss]éptimo|[Oo]ctavo|[Nn]oveno|[Dd]écimo|[Úú]nico|[Ff]inal|\d{1,3}\s*[°ºo]?)\s*[.\-–—:])/g;
  const headingMatches = [...texto.matchAll(incisoHeadingRe)];
  if (headingMatches.length >= 1) {
    for (let i = 0; i < headingMatches.length; i++) {
      const match = headingMatches[i];
      // Prefer the start of the "Inciso …" capture so prefixes like ".\n" do not
      // break label extraction when slicing the chunk.
      const captured = match[1] ?? "Inciso";
      const rawStart = match.index ?? 0;
      const start = rawStart + match[0].indexOf(captured);
      const next = headingMatches[i + 1];
      const nextCaptured = next?.[1] ?? "Inciso";
      const end = next
        ? (next.index ?? texto.length) + next[0].indexOf(nextCaptured)
        : texto.length;
      const chunk = texto.slice(start, end).trim();
      const labelMatch = chunk.match(/^Inciso\s+([A-Za-zÁÉÍÓÚáéíóúñÑ0-9º°]+)/i);
      if (labelMatch) {
        incisos.push({ label: labelMatch[1], texto: chunk });
      }
    }
  } else {
    // Approximate numbered paragraphs as inciso 1, 2, ...
    // In Chilean drafting the first paragraph of the article *is* inciso 1
    // (often starting with "Art. N.- …"), so include every paragraph.
    const paragraphs = texto
      .split(/\s{2,}|\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 40);
    paragraphs.forEach((p, i) => {
      incisos.push({ label: String(i + 1), texto: p });
    });
  }

  return { incisos, literales };
}

/** Exported for unit testing; also used internally by parseNormaTexto. */
export function flattenArticles(
  parts: NormaPart[],
  idNorma: string,
  out: NormaTexto["articulos"] = [],
): NormaTexto["articulos"] {
  for (const part of parts) {
    if (
      /^art[ií]culo$/i.test(part.tipo) ||
      /^art[ií]culo\b/i.test(part.texto)
    ) {
      // Prefer parsing the number from the article body ("Artículo 58
      // bis.-" / "Art. 2º."); fall back to the structured <NombreParte>
      // metadata (e.g. "58 bis") for the rare cases where the body text
      // doesn't start with a recognizable "Art[ículo]" prefix at all.
      const numero =
        normalizeArticleNumber(part.texto) ??
        (part.nombreParte
          ? normalizeFromNombreParte(part.nombreParte)
          : undefined) ??
        part.titulo ??
        "?";
      const { incisos, literales } = parseIncisosAndLiterales(part.texto);
      out.push({
        numero,
        idParte: part.idParte,
        texto: part.texto,
        url: part.idParte
          ? `https://www.bcn.cl/leychile/navegar?idNorma=${idNorma}&idParte=${part.idParte}`
          : `https://www.bcn.cl/leychile/navegar?idNorma=${idNorma}`,
        incisos,
        literales,
      });
    }
    if (part.children.length) flattenArticles(part.children, idNorma, out);
  }
  return out;
}

function stripNamespaces(xml: string): string {
  return xml.replace(NS_STRIP, "");
}

export async function fetchNormaXml(
  idNorma: string,
  opts: {
    signal?: AbortSignal;
    timeoutMs?: number;
    retries?: number;
  } = {},
): Promise<string> {
  const code = idNorma.replace(/\D/g, "");
  // Check 429 cool-down inside the loader so fresh/stale cache still wins.
  return xmlCache.getOrSet(`xml:${code}`, async () => {
    const blockedUntil = xml429Until.get(code);
    if (blockedUntil && Date.now() < blockedUntil) {
      throw new LeyChileRateLimitError(code, blockedUntil - Date.now());
    }
    const xmlUrl = `https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=${code}`;
    try {
      const xml = await fetchTextWithRetry(
        xmlUrl,
        {
          headers: {
            Accept: "application/xml,text/xml,*/*",
            "Accept-Language": "es-CL,es;q=0.9",
          },
        },
        opts.timeoutMs ?? 20_000,
        opts.retries ?? 2,
        opts.signal,
      );
      if (!xml.includes("<Norma") && !xml.includes("normaId")) {
        throw new LeyChileXmlError(
          code,
          "la respuesta no contiene un nodo Norma",
        );
      }
      xml429Until.delete(code);
      return xml;
    } catch (error) {
      if (
        (error instanceof HttpStatusError && error.status === 429) ||
        error instanceof LeyChileRateLimitError
      ) {
        const wait =
          error instanceof HttpStatusError
            ? (error.retryAfterMs ?? XML_429_CACHE_MS)
            : error.retryAfterMs;
        xml429Until.set(code, Date.now() + wait);
        throw new LeyChileRateLimitError(code, wait);
      }
      throw error;
    }
  });
}

export async function parseNormaTexto(
  idNorma: string,
  opts: {
    signal?: AbortSignal;
    timeoutMs?: number;
    retries?: number;
  } = {},
): Promise<NormaTexto> {
  const code = idNorma.replace(/\D/g, "");
  return xmlCache.getOrSet(`parsed:${code}`, async () => {
    const xml = await fetchNormaXml(code, opts);
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      trimValues: false,
    });
    const doc = parser.parse(stripNamespaces(xml)) as Record<string, unknown>;
    const norma = (doc.Norma ?? doc) as Record<string, unknown>;
    const identificador = (norma.Identificador ?? {}) as Record<
      string,
      unknown
    >;
    const metadatos = (norma.Metadatos ?? {}) as Record<string, unknown>;
    const tipoNumero = asArray(
      ((identificador.TiposNumeros as Record<string, unknown> | undefined)
        ?.TipoNumero ?? undefined) as
        Record<string, unknown> | Record<string, unknown>[] | undefined,
    )[0] as Record<string, unknown> | undefined;

    const structures = asArray(norma.EstructurasFuncionales).flatMap(
      (block) => {
        const b = block as Record<string, unknown>;
        return asArray(b.EstructuraFuncional).map((child) =>
          parsePart(child as Record<string, unknown>),
        );
      },
    );

    const articulos = flattenArticles(structures, code);
    if (structures.length === 0) {
      throw new UnsupportedNormaStructureError(
        code,
        "el XML no contiene EstructurasFuncionales parseables",
      );
    }

    return {
      idNorma: code,
      titulo: decodeEntities(textOf(metadatos.TituloNorma)) || `Norma ${code}`,
      tipo: decodeEntities(textOf(tipoNumero?.Tipo)),
      numero: decodeEntities(textOf(tipoNumero?.Numero)),
      fechaPublicacion: identificador["@_fechaPublicacion"]
        ? String(identificador["@_fechaPublicacion"])
        : undefined,
      fechaVersion: norma["@_fechaVersion"]
        ? String(norma["@_fechaVersion"])
        : undefined,
      derogado: norma["@_derogado"] ? String(norma["@_derogado"]) : undefined,
      materias: asArray(metadatos.Materias)
        .flatMap((m) =>
          asArray((m as Record<string, unknown>).Materia).map((x) =>
            decodeEntities(textOf(x)),
          ),
        )
        .filter(Boolean),
      organismos: asArray(identificador.Organismos)
        .flatMap((o) =>
          asArray((o as Record<string, unknown>).Organismo).map((x) =>
            decodeEntities(textOf(x)),
          ),
        )
        .filter(Boolean),
      url: `https://www.bcn.cl/leychile/navegar?idNorma=${code}`,
      xmlUrl: `https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=${code}`,
      partes: structures,
      articulos,
    };
  });
}

export function findArticulo(
  norma: NormaTexto,
  articulo: string,
): NormaTexto["articulos"][number] | undefined {
  const needle = normalizeArticleKey(articulo);
  if (!needle) return undefined;

  return norma.articulos.find((art) => {
    const n = normalizeArticleKey(art.numero);
    return n === needle;
  });
}

export function availableArticleNumbers(norma: NormaTexto): string[] {
  return norma.articulos
    .map((a) => a.numero)
    .filter((n, i, all) => Boolean(n) && all.indexOf(n) === i);
}

export function requireArticulo(
  norma: NormaTexto,
  articulo: string,
): NormaTexto["articulos"][number] {
  const art = findArticulo(norma, articulo);
  if (!art) throw new ArticleNotFoundError(norma, articulo);
  if (!art.texto.trim()) {
    throw new UnsupportedNormaStructureError(
      norma.idNorma,
      `el artículo ${art.numero} existe pero no trae texto parseable`,
    );
  }
  return art;
}

export class FragmentNotFoundError extends Error {
  constructor(
    kind: "inciso" | "letra",
    requested: string,
    available: string[],
  ) {
    const list =
      available.length > 0
        ? available.join(", ")
        : "ninguno detectado en el parseo del artículo";
    super(`No se encontró ${kind} ${requested}. Disponibles: ${list}`);
    this.name = "FragmentNotFoundError";
  }
}

export function findIncisoOrLiteral(
  art: NormaTexto["articulos"][number],
  opts: { inciso?: string; letra?: string },
): { kind: "inciso" | "literal" | "articulo"; texto: string; label: string } {
  if (opts.letra) {
    const needle = opts.letra.replace(/[^a-z]/gi, "").toLowerCase();
    const lit = art.literales.find((l) => l.letra.toLowerCase() === needle);
    if (lit) {
      return { kind: "literal", texto: lit.texto, label: `lit. ${lit.letra})` };
    }
    throw new FragmentNotFoundError(
      "letra",
      opts.letra,
      art.literales.map((l) => l.letra),
    );
  }
  if (opts.inciso) {
    const inc = art.incisos.find((i) =>
      incisoLabelsMatch(i.label, opts.inciso!),
    );
    if (inc) {
      return { kind: "inciso", texto: inc.texto, label: `inc. ${inc.label}` };
    }
    throw new FragmentNotFoundError(
      "inciso",
      opts.inciso,
      art.incisos.map((i) => i.label),
    );
  }
  return { kind: "articulo", texto: art.texto, label: `art. ${art.numero}` };
}

export function normaToPlainText(
  norma: NormaTexto,
  opts: {
    maxChars?: number;
    articulo?: string;
    modo?: "indice" | "cuerpo";
  } = {},
): string {
  const maxChars = opts.maxChars ?? 12_000;
  if (opts.articulo) {
    const art = requireArticulo(norma, opts.articulo);
    return [
      `${norma.tipo ?? "Norma"} ${norma.numero ?? norma.idNorma} — ${norma.titulo}`,
      `Artículo ${art.numero}`,
      art.url,
      "",
      art.texto,
    ].join("\n");
  }

  if (opts.modo === "indice") {
    return [
      `${norma.tipo ?? "Norma"} ${norma.numero ?? norma.idNorma} — ${norma.titulo}`,
      `idNorma: ${norma.idNorma}`,
      `URL: ${norma.url}`,
      `Artículos: ${norma.articulos.length}`,
      "",
      ...norma.articulos.map(
        (a) =>
          `- art. ${a.numero}${a.idParte ? ` (idParte ${a.idParte})` : ""} — ${a.url}`,
      ),
    ].join("\n");
  }

  const chunks: string[] = [
    `${norma.tipo ?? "Norma"} ${norma.numero ?? norma.idNorma} — ${norma.titulo}`,
    `idNorma: ${norma.idNorma}`,
    `URL: ${norma.url}`,
    norma.fechaPublicacion
      ? `Publicación: ${norma.fechaPublicacion}`
      : undefined,
    norma.fechaVersion ? `Versión: ${norma.fechaVersion}` : undefined,
    norma.derogado ? `Estado: ${norma.derogado}` : undefined,
    norma.materias.length
      ? `Materias: ${norma.materias.join("; ")}`
      : undefined,
    "",
    "## Artículos",
    "",
  ].filter((x): x is string => Boolean(x));

  for (const art of norma.articulos) {
    const block = `### Artículo ${art.numero}\n${art.texto}\n`;
    if (chunks.join("\n").length + block.length > maxChars) {
      chunks.push(
        `\n[Texto truncado por longitud. Quedan ${norma.articulos.length - norma.articulos.indexOf(art)} artículos. Usa modo=indice u obtener_articulo.]`,
      );
      break;
    }
    chunks.push(block);
  }

  return chunks.join("\n");
}
