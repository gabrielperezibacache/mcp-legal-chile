import { XMLParser } from "fast-xml-parser";
import { xmlCache } from "../cache.js";
import { fetchText } from "../util.js";

const NS_STRIP = /\{[^}]+\}/g;

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
  }>;
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

function flattenArticles(
  parts: NormaPart[],
  idNorma: string,
  out: NormaTexto["articulos"] = [],
): NormaTexto["articulos"] {
  for (const part of parts) {
    if (/art[ií]culo/i.test(part.tipo) || /^art[ií]culo/i.test(part.texto)) {
      const numero = normalizeArticleNumber(part.texto) ?? part.titulo ?? "?";
      out.push({
        numero,
        idParte: part.idParte,
        texto: part.texto,
        url: part.idParte
          ? `https://www.bcn.cl/leychile/navegar?idNorma=${idNorma}&idParte=${part.idParte}`
          : `https://www.bcn.cl/leychile/navegar?idNorma=${idNorma}`,
      });
    }
    if (part.children.length) flattenArticles(part.children, idNorma, out);
  }
  return out;
}

function stripNamespaces(xml: string): string {
  return xml.replace(NS_STRIP, "");
}

export async function fetchNormaXml(idNorma: string): Promise<string> {
  const code = idNorma.replace(/\D/g, "");
  return xmlCache.getOrSet(`xml:${code}`, async () => {
    const xmlUrl = `https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=${code}`;
    const xml = await fetchText(
      xmlUrl,
      {
        headers: {
          Accept: "application/xml,text/xml,*/*",
          "Accept-Language": "es-CL,es;q=0.9",
        },
      },
      60_000,
    );
    if (!xml.includes("<Norma") && !xml.includes("normaId")) {
      throw new Error(`La BCN no devolvió XML válido para idNorma=${code}`);
    }
    return xml;
  });
}

export async function parseNormaTexto(idNorma: string): Promise<NormaTexto> {
  const code = idNorma.replace(/\D/g, "");
  return xmlCache.getOrSet(`parsed:${code}`, async () => {
    const xml = await fetchNormaXml(code);
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
  const needle = articulo
    .toLowerCase()
    .replace(/art[ií]culo/gi, "")
    .replace(/[º°]/g, "")
    .replace(/\s+/g, "")
    .trim();

  return norma.articulos.find((art) => {
    const n = art.numero
      .toLowerCase()
      .replace(/[º°]/g, "")
      .replace(/\s+/g, "");
    return n === needle || n.startsWith(needle) || needle.startsWith(n);
  });
}

export function normaToPlainText(
  norma: NormaTexto,
  opts: { maxChars?: number; articulo?: string } = {},
): string {
  const maxChars = opts.maxChars ?? 12_000;
  if (opts.articulo) {
    const art = findArticulo(norma, opts.articulo);
    if (!art) {
      return `No se encontró el artículo ${opts.articulo} en la norma ${norma.idNorma}. Artículos disponibles: ${norma.articulos
        .map((a) => a.numero)
        .slice(0, 30)
        .join(", ")}`;
    }
    return [
      `${norma.tipo ?? "Norma"} ${norma.numero ?? norma.idNorma} — ${norma.titulo}`,
      `Artículo ${art.numero}`,
      art.url,
      "",
      art.texto,
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
        `\n[Texto truncado por longitud. Quedan ${norma.articulos.length - norma.articulos.indexOf(art)} artículos. Usa obtener_articulo o reduce el alcance.]`,
      );
      break;
    }
    chunks.push(block);
  }

  return chunks.join("\n");
}
