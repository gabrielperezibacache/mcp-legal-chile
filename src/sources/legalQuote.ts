import { formatChileanCitation } from "../citation.js";
import {
  findArticulo,
  findIncisoOrLiteral,
  parseNormaTexto,
  type NormaTexto,
} from "./normaTexto.js";

export interface LegalQuote {
  citation: string;
  idNorma: string;
  titulo: string;
  tipo?: string;
  numero?: string;
  articulo: string;
  inciso?: string;
  letra?: string;
  url: string;
  texto: string;
  blockquote: string;
  markdown: string;
}

/** Official legal text ready to paste into a brief, with formal citation. */
export async function citarTextoLegal(opts: {
  id_norma: string;
  articulo: string;
  inciso?: string;
  letra?: string;
}): Promise<LegalQuote> {
  const norma = await parseNormaTexto(opts.id_norma);
  const art = findArticulo(norma, opts.articulo);
  if (!art) {
    throw new Error(
      `No se encontró el artículo ${opts.articulo}. Disponibles: ${norma.articulos
        .map((a) => a.numero)
        .slice(0, 40)
        .join(", ")}`,
    );
  }

  const frag = findIncisoOrLiteral(art, {
    inciso: opts.inciso,
    letra: opts.letra,
  });
  const cited = formatChileanCitation({
    tipo: norma.tipo,
    numero: norma.numero,
    articulo: art.numero,
    inciso: opts.inciso,
    letra: opts.letra,
    url: art.url,
  });

  const texto = frag.texto;
  const blockquote = texto
    .split(/(?<=\.)\s+/)
    .map((line) => `> ${line}`)
    .join("\n");

  const markdown = [
    `### Texto legal citado`,
    `**${cited.citation}**`,
    `*${norma.titulo}*`,
    "",
    `- Fuente oficial: ${art.url}`,
    `- Evidencia: texto íntegro LeyChile (idNorma ${norma.idNorma})`,
    "",
    blockquote,
    "",
    `_Para la pieza: «${cited.citation}»._`,
  ].join("\n");

  return {
    citation: cited.citation,
    idNorma: norma.idNorma,
    titulo: norma.titulo,
    tipo: norma.tipo,
    numero: norma.numero,
    articulo: art.numero,
    inciso: opts.inciso,
    letra: opts.letra,
    url: art.url,
    texto,
    blockquote,
    markdown,
  };
}

export function normaIndiceMarkdown(norma: NormaTexto): string {
  return [
    `# ${norma.tipo ?? "Norma"} ${norma.numero ?? norma.idNorma} — ${norma.titulo}`,
    `idNorma: ${norma.idNorma}`,
    `URL: ${norma.url}`,
    "",
    "## Índice de artículos (para citar con citar_texto_legal)",
    ...norma.articulos.map(
      (a) => `- art. ${a.numero} → idParte ${a.idParte ?? "n/d"} — ${a.url}`,
    ),
  ].join("\n");
}
