import { XMLParser } from "fast-xml-parser";
import { xmlCache } from "../cache.js";
import { fetchTextWithRetry, HttpStatusError } from "../util.js";

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
    super(`LeyChile XML inválido/no disponible para idNorma=${idNorma}: ${detail}`);
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

function decodeEntities(text: string): string {
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
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeArticleNumber(texto: string): string | undefined {
  const match = texto.match(
    /art[ií]culo\s*([0-9]+(?:\s*(?:bis|ter|quáter|quater|quinquies))?(?:º|°)?)/i,
  );
  if (!match) return undefined;
  return match[1].replace(/\s+/g, " ").replace(/[º°]/g, "").trim();
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
    tipo: String(node["@_tipoParte"] ?? ""),
    idParte: node["@_idParte"] ? String(node["@_idParte"]) : undefined,
    titulo: decodeEntities(textOf(meta.TituloParte)),
    texto: decodeEntities(textOf(node.Texto)),
    derogado: node["@_derogado"] ? String(node["@_derogado"]) : undefined,
    children,
  };
}

function parseIncisosAndLiterales(texto: string): {
  incisos: Array<{ label: string; texto: string }>;
  literales: Array<{ letra: string; texto: string }>;
} {
  const literales: Array<{ letra: string; texto: string }> = [];
  const litRe =
    /(?:^|[;\.\s])([a-z]|[a-z]\))[\).\-–—]\s*([^;]+?)(?=(?:[;\.]\s*[a-z][\).\-–—])|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = litRe.exec(texto)) !== null) {
    const letra = m[1].replace(")", "");
    const body = m[2].trim();
    if (body.length > 8) literales.push({ letra, texto: body });
  }

  const incisos: Array<{ label: string; texto: string }> = [];
  const parts = texto.split(/(?=\bInciso\s+[A-Za-z0-9º°]+)/i).filter(Boolean);
  if (parts.length > 1) {
    for (const part of parts) {
      const labelMatch = part.match(/^Inciso\s+([A-Za-z0-9º°]+)/i);
      if (labelMatch) {
        incisos.push({
          label: labelMatch[1],
          texto: part.trim(),
        });
      }
    }
  } else {
    // Approximate numbered paragraphs as inciso 1, 2, ...
    const paragraphs = texto
      .split(/\s{2,}|\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 40);
    paragraphs.forEach((p, i) => {
      if (i === 0) return;
      incisos.push({ label: String(i + 1), texto: p });
    });
  }

  return { incisos, literales };
}

function flattenArticles(
  parts: NormaPart[],
  idNorma: string,
  out: NormaTexto["articulos"] = [],
): NormaTexto["articulos"] {
  for (const part of parts) {
    if (/art[ií]culo/i.test(part.tipo) || /^art[ií]culo/i.test(part.texto)) {
      const numero = normalizeArticleNumber(part.texto) ?? part.titulo ?? "?";
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
  const blockedUntil = xml429Until.get(code);
  if (blockedUntil && Date.now() < blockedUntil) {
    throw new LeyChileRateLimitError(code, blockedUntil - Date.now());
  }
  return xmlCache.getOrSet(`xml:${code}`, async () => {
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
        opts.timeoutMs ?? 60_000,
        opts.retries ?? 4,
        opts.signal,
      );
      if (!xml.includes("<Norma") && !xml.includes("normaId")) {
        throw new LeyChileXmlError(code, "la respuesta no contiene un nodo Norma");
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
            ? error.retryAfterMs ?? XML_429_CACHE_MS
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
    const identificador = (norma.Identificador ?? {}) as Record<string, unknown>;
    const metadatos = (norma.Metadatos ?? {}) as Record<string, unknown>;
    const tipoNumero = asArray(
      ((identificador.TiposNumeros as Record<string, unknown> | undefined)
        ?.TipoNumero ?? undefined) as
        | Record<string, unknown>
        | Record<string, unknown>[]
        | undefined,
    )[0] as Record<string, unknown> | undefined;

    const structures = asArray(norma.EstructurasFuncionales).flatMap((block) => {
      const b = block as Record<string, unknown>;
      return asArray(b.EstructuraFuncional).map((child) =>
        parsePart(child as Record<string, unknown>),
      );
    });

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
    const lit = art.literales.find(
      (l) => l.letra.toLowerCase() === needle,
    );
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
    const needle = opts.inciso.replace(/[º°]/g, "").toLowerCase();
    const inc = art.incisos.find(
      (i) => i.label.replace(/[º°]/g, "").toLowerCase() === needle,
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
    norma.materias.length ? `Materias: ${norma.materias.join("; ")}` : undefined,
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
