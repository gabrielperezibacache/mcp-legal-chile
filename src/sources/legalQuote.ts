import { formatChileanCitation } from "../citation.js";
import {
  findIncisoOrLiteral,
  parseNormaTexto,
  requireArticulo,
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
  const art = requireArticulo(norma, opts.articulo);

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

  const scope = [
    opts.inciso ? `inciso ${opts.inciso}` : null,
    opts.letra ? `literal ${opts.letra}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const markdown = [
    `### Texto legal citado`,
    "",
    "**Cita lista para pegar:**",
    "",
    `> ${cited.citation}`,
    "",
    `*${norma.titulo}*`,
    "",
    `- **Integridad:** \`verified\` — texto oficial LeyChile`,
    `- **idNorma:** \`${norma.idNorma}\``,
    `- **Artículo:** ${art.numero}${scope ? ` (${scope})` : ""}`,
    `- **URL oficial:** ${art.url}`,
    "",
    "**Texto oficial:**",
    "",
    blockquote,
    "",
    `_En el escrito puedes usar: «${cited.citation}»._`,
    "",
    "→ Para otro artículo de la misma norma: `obtener_texto_norma` modo `indice`, luego `citar_texto_legal`.",
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
  const sample = norma.articulos.slice(0, 3).map((a) => a.numero);
  return [
    `# ${norma.tipo ?? "Norma"} ${norma.numero ?? norma.idNorma} — ${norma.titulo}`,
    "",
    `- **idNorma:** \`${norma.idNorma}\``,
    `- **URL:** ${norma.url}`,
    `- **Artículos detectados:** ${norma.articulos.length}`,
    "",
    "## Índice de artículos",
    ...norma.articulos.map((a) => `- art. **${a.numero}** — ${a.url}`),
    "",
    sample.length
      ? `→ Texto oficial: \`citar_texto_legal\` con id_norma \`${norma.idNorma}\` y articulo (ej. \`${sample[0]}\`).`
      : "→ Sin artículos parseables; verifica en LeyChile.",
  ].join("\n");
}
