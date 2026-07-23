import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatChileanCitation } from "../citation.js";
import {
  citarTextoLegal,
  searchLegislacion,
  getNorma,
  estadoNorma,
  normasRelacionadas,
} from "../sources/index.js";
import {
  findIncisoOrLiteral,
  normaToPlainText,
  parseNormaTexto,
  requireArticulo,
} from "../sources/normaTexto.js";
import { formatResultsJson } from "../util.js";
import {
  fail,
  formatoSchema,
  legalExtractionFailure,
  limitSchema,
  okSearch,
  okText,
  timed,
  timedSearch,
} from "./helpers.js";

export function registerLegislacionTools(server: McpServer): void {
  server.registerTool(
    "buscar_legislacion",
    {
      title: "Buscar legislación chilena",
      description:
        "Busca normativa chilena en BCN/LeyChile: número de ley, aliases (p. ej. Código del Trabajo) o lenguaje natural. Fallback: SPARQL permisivo + buscador HTML LeyChile. Para texto íntegro usa obtener_texto_norma / obtener_articulo.",
      inputSchema: {
        consulta: z.string().min(2),
        limite: limitSchema,
        formato: formatoSchema,
      },
    },
    async ({ consulta, limite, formato }) => {
      try {
        return okSearch(
          await timedSearch("buscar_legislacion", (signal) =>
            searchLegislacion(consulta, limite, { signal }),
          ),
          formato,
        );
      } catch (error) {
        return fail(
          `Error al buscar legislación: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "obtener_norma",
    {
      title: "Obtener norma por idNorma o número",
      description: "Metadatos BCN de una norma chilena.",
      inputSchema: {
        id_norma: z.string().optional(),
        numero: z.string().optional(),
        consulta: z.string().optional(),
        formato: formatoSchema,
      },
    },
    async ({ id_norma, numero, consulta, formato }) => {
      try {
        return okSearch(
          await timed("obtener_norma", () =>
            getNorma({
              leychileCode: id_norma,
              number: numero,
              query: consulta,
            }),
          ),
          formato,
        );
      } catch (error) {
        return fail(
          `Error al obtener norma: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "estado_norma",
    {
      title: "Estado / vigencia aproximada de una norma",
      description:
        "Metadatos de publicación y enlaces a historia LeyChile. Confirma siempre en la fuente oficial.",
      inputSchema: {
        id_norma: z.string().min(1),
        formato: formatoSchema,
      },
    },
    async ({ id_norma, formato }) => {
      try {
        const data = await timed("estado_norma", () => estadoNorma(id_norma));
        return okText(
          formato === "json"
            ? formatResultsJson(data)
            : [
                `## Estado de norma idNorma=${data.idNorma}`,
                `**${data.titulo ?? "Sin título"}**`,
                `- Cita: ${data.citation ?? "n/d"}`,
                `- Publicación: ${data.fechaPublicacion ?? "n/d"}`,
                `- URL: ${data.url}`,
                `- Historia: ${data.historiaUrl}`,
                "",
                ...(Array.isArray(data.warnings)
                  ? data.warnings.map((w: string) => `- _${w}_`)
                  : []),
              ].join("\n"),
        );
      } catch (error) {
        return fail(
          `Error estado_norma: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "normas_relacionadas",
    {
      title: "Normas relacionadas",
      description:
        "Normas relacionadas por predicados estructurados de BCN (modifica/modificada por/refunde/rectificada por/regulada por/concuerda con) + enlace a historia LeyChile.",
      inputSchema: {
        id_norma: z.string().min(1),
        formato: formatoSchema,
      },
    },
    async ({ id_norma, formato }) => {
      try {
        return okSearch(
          await timed("normas_relacionadas", () =>
            normasRelacionadas(id_norma),
          ),
          formato,
        );
      } catch (error) {
        return fail(
          `Error normas_relacionadas: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "obtener_texto_norma",
    {
      title: "Texto oficial de una norma (XML LeyChile)",
      description:
        "XML oficial. modo=indice lista artículos; modo=cuerpo devuelve texto (truncable).",
      inputSchema: {
        id_norma: z.string().min(1),
        max_chars: z.number().int().min(1000).max(50_000).default(8_000),
        modo: z.enum(["indice", "cuerpo"]).default("cuerpo"),
        formato: formatoSchema,
      },
    },
    async ({ id_norma, max_chars, modo, formato }) => {
      try {
        const norma = await timed("obtener_texto_norma", () =>
          parseNormaTexto(id_norma),
        );
        const body = normaToPlainText(norma, { maxChars: max_chars, modo });
        if (formato === "json") {
          return okText(
            formatResultsJson({
              idNorma: norma.idNorma,
              titulo: norma.titulo,
              tipo: norma.tipo,
              numero: norma.numero,
              fechaPublicacion: norma.fechaPublicacion,
              fechaVersion: norma.fechaVersion,
              derogado: norma.derogado,
              url: norma.url,
              articulos: norma.articulos.map((a) => ({
                numero: a.numero,
                idParte: a.idParte,
                url: a.url,
              })),
              texto: body,
              evidence: "full_text",
            }),
          );
        }
        return okText(
          [
            `# ${norma.tipo ?? "Norma"} ${norma.numero ?? norma.idNorma}`,
            `**${norma.titulo}**`,
            `- URL: ${norma.url}`,
            `- Evidencia: texto íntegro (${modo})`,
            "",
            body,
          ].join("\n"),
        );
      } catch (error) {
        return legalExtractionFailure(error, id_norma);
      }
    },
  );

  server.registerTool(
    "obtener_articulo",
    {
      title: "Obtener un artículo específico",
      description: "Artículo puntual del XML oficial de LeyChile.",
      inputSchema: {
        id_norma: z.string().min(1),
        articulo: z.string().min(1),
        formato: formatoSchema,
      },
    },
    async ({ id_norma, articulo, formato }) => {
      try {
        const norma = await timed("obtener_articulo", () =>
          parseNormaTexto(id_norma),
        );
        const art = requireArticulo(norma, articulo);
        const citation = formatChileanCitation({
          tipo: norma.tipo,
          numero: norma.numero,
          articulo: art.numero,
          url: art.url,
        });
        if (formato === "json") {
          return okText(
            formatResultsJson({
              norma: {
                idNorma: norma.idNorma,
                titulo: norma.titulo,
                numero: norma.numero,
                tipo: norma.tipo,
              },
              articulo: art,
              citation: citation.citation,
              evidence: "full_text",
            }),
          );
        }
        return okText(
          [
            `### ${citation.citation}`,
            `**${norma.titulo}**`,
            `- URL: ${art.url}`,
            `- Evidencia: texto íntegro`,
            "",
            "**Texto oficial:**",
            "",
            art.texto,
          ].join("\n"),
        );
      } catch (error) {
        return legalExtractionFailure(error, id_norma);
      }
    },
  );

  server.registerTool(
    "obtener_inciso",
    {
      title: "Obtener inciso o literal de un artículo",
      description:
        "Extrae inciso/literal aproximado del texto oficial del artículo.",
      inputSchema: {
        id_norma: z.string().min(1),
        articulo: z.string().min(1),
        inciso: z.string().optional(),
        letra: z.string().optional(),
        formato: formatoSchema,
      },
    },
    async ({ id_norma, articulo, inciso, letra, formato }) => {
      try {
        if (!inciso && !letra) {
          return fail("Indica inciso o letra para obtener un fragmento.");
        }
        const norma = await timed("obtener_inciso", () =>
          parseNormaTexto(id_norma),
        );
        const art = requireArticulo(norma, articulo);
        const frag = findIncisoOrLiteral(art, { inciso, letra });
        const citation = formatChileanCitation({
          tipo: norma.tipo,
          numero: norma.numero,
          articulo: art.numero,
          inciso,
          letra,
          url: art.url,
        });
        if (formato === "json") {
          return okText(
            formatResultsJson({
              citation: citation.citation,
              fragment: frag,
              url: art.url,
              evidence: "full_text",
            }),
          );
        }
        return okText(
          [
            `### ${citation.citation}`,
            `Fragmento: ${frag.label} (${frag.kind})`,
            art.url,
            "",
            frag.texto,
            "",
            "_Parseo heurístico de incisos/literales; verifica en LeyChile._",
          ].join("\n"),
        );
      } catch (error) {
        return legalExtractionFailure(error, id_norma);
      }
    },
  );

  server.registerTool(
    "formatear_cita",
    {
      title: "Formatear cita chilena",
      description:
        "Genera cadena de cita formal SOLO con identificadores ya recuperados (norma, ROL, dictamen o doctrina). No inventa datos.",
      inputSchema: {
        tipo: z.string().optional(),
        numero: z.string().optional(),
        articulo: z.string().optional(),
        inciso: z.string().optional(),
        letra: z.string().optional(),
        rol: z.string().optional(),
        tribunal: z.string().optional(),
        considerando: z
          .string()
          .optional()
          .describe("Considerando: 15, 15º o décimo quinto"),
        dictamen: z.string().optional(),
        anio: z.string().optional(),
        titulo: z.string().optional(),
        url: z.string().optional(),
        autores: z.string().optional().describe("Autores de doctrina"),
        revista: z.string().optional(),
        doi: z.string().optional(),
        volumen: z.string().optional(),
        pagina: z.string().optional(),
      },
    },
    async (input) => {
      const cited = formatChileanCitation(input);
      return okText(
        [
          `**Cita:** ${cited.citation}`,
          cited.url ? `**URL:** ${cited.url}` : undefined,
          ...cited.notes.map((n) => `- ${n}`),
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  );

  server.registerTool(
    "citar_texto_legal",
    {
      title: "Citar texto legal oficial con blockquote",
      description:
        "Devuelve cita formal chilena + texto oficial de LeyChile listo para pegar en un escrito (blockquote).",
      inputSchema: {
        id_norma: z.string().min(1),
        articulo: z.string().min(1),
        inciso: z.string().optional(),
        letra: z.string().optional(),
        formato: formatoSchema,
      },
    },
    async ({ id_norma, articulo, inciso, letra, formato }) => {
      try {
        const quote = await timed("citar_texto_legal", () =>
          citarTextoLegal({ id_norma, articulo, inciso, letra }),
        );
        if (formato === "json") {
          return okText(formatResultsJson({ ...quote, evidence: "full_text" }));
        }
        return okText(quote.markdown);
      } catch (error) {
        return legalExtractionFailure(error, id_norma);
      }
    },
  );
}
