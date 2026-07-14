import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatSearchMarkdown } from "./format.js";
import {
  getNorma,
  searchDictamenes,
  searchDoctrina,
  searchJurisprudencia,
  searchLegislacion,
  searchTodas,
} from "./sources/index.js";
import {
  findArticulo,
  normaToPlainText,
  parseNormaTexto,
} from "./sources/normaTexto.js";
import type { SearchResponse } from "./types.js";
import { formatResultsJson } from "./util.js";

const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(20)
  .default(8)
  .describe("Cantidad máxima de resultados (1-20)");

const formatoSchema = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("Formato de salida: markdown (recomendado para citas) o json");

function okSearch(data: SearchResponse, formato: "markdown" | "json") {
  const text =
    formato === "json" ? formatResultsJson(data) : formatSearchMarkdown(data);
  return {
    content: [{ type: "text" as const, text }],
  };
}

function okText(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "mcp-legal-chile",
    version: "1.1.0",
  });

  server.registerTool(
    "buscar_legislacion",
    {
      title: "Buscar legislación chilena",
      description:
        "Busca normativa chilena en BCN / LeyChile (leyes, decretos, resoluciones). Devuelve título, cita y enlace oficial. Para leer el texto íntegro usa obtener_texto_norma u obtener_articulo.",
      inputSchema: {
        consulta: z
          .string()
          .min(2)
          .describe(
            "Términos de búsqueda, p. ej. 'protección de datos', 'código del trabajo', 'ley 19.628'",
          ),
        limite: limitSchema,
        formato: formatoSchema,
      },
    },
    async ({ consulta, limite, formato }) => {
      try {
        return okSearch(await searchLegislacion(consulta, limite), formato);
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
      title: "Obtener una norma por idNorma o número",
      description:
        "Recupera metadatos de una norma chilena desde la BCN usando el idNorma de LeyChile o el número de la ley/decreto.",
      inputSchema: {
        id_norma: z
          .string()
          .optional()
          .describe("Código LeyChile / idNorma (p. ej. 141599 para Ley 19.628)"),
        numero: z
          .string()
          .optional()
          .describe("Número de la norma (p. ej. 19628 o 19.628)"),
        consulta: z
          .string()
          .optional()
          .describe("Si no conoces el id, búsqueda por texto"),
        formato: formatoSchema,
      },
    },
    async ({ id_norma, numero, consulta, formato }) => {
      try {
        return okSearch(
          await getNorma({
            leychileCode: id_norma,
            number: numero,
            query: consulta,
          }),
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
    "obtener_texto_norma",
    {
      title: "Obtener texto de una norma (XML LeyChile)",
      description:
        "Descarga el XML oficial de LeyChile y devuelve el texto estructurado de la norma (artículos). Usa idNorma de LeyChile (p. ej. 141599).",
      inputSchema: {
        id_norma: z
          .string()
          .min(1)
          .describe("idNorma de LeyChile, p. ej. 141599"),
        max_chars: z
          .number()
          .int()
          .min(1000)
          .max(50_000)
          .default(12_000)
          .describe("Máximo de caracteres del texto devuelto"),
        formato: formatoSchema,
      },
    },
    async ({ id_norma, max_chars, formato }) => {
      try {
        const norma = await parseNormaTexto(id_norma);
        if (formato === "json") {
          return okText(
            formatResultsJson({
              ...norma,
              partes: undefined,
              texto: normaToPlainText(norma, { maxChars: max_chars }),
            }),
          );
        }
        const body = normaToPlainText(norma, { maxChars: max_chars });
        return okText(
          [
            `# ${norma.tipo ?? "Norma"} ${norma.numero ?? norma.idNorma}`,
            `**${norma.titulo}**`,
            "",
            `- idNorma: ${norma.idNorma}`,
            `- URL: ${norma.url}`,
            `- XML: ${norma.xmlUrl}`,
            norma.fechaPublicacion
              ? `- Publicación: ${norma.fechaPublicacion}`
              : undefined,
            norma.fechaVersion ? `- Versión: ${norma.fechaVersion}` : undefined,
            norma.derogado ? `- Estado: ${norma.derogado}` : undefined,
            norma.materias.length
              ? `- Materias: ${norma.materias.join("; ")}`
              : undefined,
            "",
            "## Texto (oficial LeyChile)",
            "",
            body,
            "",
            "_Cita solo este texto. No inventes artículos adicionales._",
          ]
            .filter((x): x is string => Boolean(x))
            .join("\n"),
        );
      } catch (error) {
        return fail(
          `Error al obtener texto de la norma: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "obtener_articulo",
    {
      title: "Obtener un artículo específico",
      description:
        "Extrae un artículo puntual del XML oficial de LeyChile (por idNorma + número de artículo).",
      inputSchema: {
        id_norma: z.string().min(1).describe("idNorma LeyChile, p. ej. 141599"),
        articulo: z
          .string()
          .min(1)
          .describe("Número del artículo, p. ej. '2', '2 bis', '4º'"),
        formato: formatoSchema,
      },
    },
    async ({ id_norma, articulo, formato }) => {
      try {
        const norma = await parseNormaTexto(id_norma);
        const art = findArticulo(norma, articulo);
        if (!art) {
          return fail(
            `No se encontró el artículo ${articulo}. Disponibles: ${norma.articulos
              .map((a) => a.numero)
              .slice(0, 40)
              .join(", ")}`,
          );
        }
        if (formato === "json") {
          return okText(
            formatResultsJson({
              norma: {
                idNorma: norma.idNorma,
                titulo: norma.titulo,
                numero: norma.numero,
                tipo: norma.tipo,
                url: norma.url,
              },
              articulo: art,
              citation: `${norma.tipo ?? "Norma"} ${norma.numero}, art. ${art.numero}`,
            }),
          );
        }
        return okText(
          [
            `### ${norma.tipo ?? "Norma"} ${norma.numero ?? norma.idNorma}, artículo ${art.numero}`,
            `**${norma.titulo}**`,
            "",
            `- **Cita:** ${norma.tipo ?? "Norma"} N° ${norma.numero}, art. ${art.numero}`,
            `- **URL del artículo:** ${art.url}`,
            `- **URL de la norma:** ${norma.url}`,
            "",
            "**Texto oficial:**",
            "",
            art.texto,
          ].join("\n"),
        );
      } catch (error) {
        return fail(
          `Error al obtener artículo: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "buscar_jurisprudencia",
    {
      title: "Buscar jurisprudencia chilena",
      description:
        "Busca sentencias y fallos (Poder Judicial y Tribunal Constitucional) con URLs para verificación. No inventes fallos si no aparecen aquí.",
      inputSchema: {
        consulta: z
          .string()
          .min(2)
          .describe(
            "Tema o criterios del fallo, p. ej. 'despido injustificado', 'recurso de protección salud'",
          ),
        limite: limitSchema,
        formato: formatoSchema,
      },
    },
    async ({ consulta, limite, formato }) => {
      try {
        return okSearch(await searchJurisprudencia(consulta, limite), formato);
      } catch (error) {
        return fail(
          `Error al buscar jurisprudencia: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "buscar_doctrina",
    {
      title: "Buscar doctrina jurídica chilena",
      description:
        "Busca artículos académicos y doctrina jurídica chilena (OpenAlex / revistas chilenas) con DOI y enlaces verificables.",
      inputSchema: {
        consulta: z
          .string()
          .min(2)
          .describe(
            "Tema doctrinal, p. ej. 'precedentes en Chile', 'responsabilidad civil extracontractual'",
          ),
        limite: limitSchema,
        formato: formatoSchema,
      },
    },
    async ({ consulta, limite, formato }) => {
      try {
        return okSearch(await searchDoctrina(consulta, limite), formato);
      } catch (error) {
        return fail(
          `Error al buscar doctrina: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "buscar_dictamenes",
    {
      title: "Buscar dictámenes de la administración",
      description:
        "Busca dictámenes y pronunciamientos (p. ej. Contraloría General de la República) con enlaces públicos.",
      inputSchema: {
        consulta: z
          .string()
          .min(2)
          .describe(
            "Tema o número del dictamen, p. ej. 'viáticos funcionarios', 'dictamen 12345'",
          ),
        limite: limitSchema,
        formato: formatoSchema,
      },
    },
    async ({ consulta, limite, formato }) => {
      try {
        return okSearch(await searchDictamenes(consulta, limite), formato);
      } catch (error) {
        return fail(
          `Error al buscar dictámenes: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "buscar_derecho_chileno",
    {
      title: "Búsqueda unificada de derecho chileno",
      description:
        "Consulta simultánea en legislación, jurisprudencia, doctrina y dictámenes. Ideal como primera pasada.",
      inputSchema: {
        consulta: z
          .string()
          .min(2)
          .describe("Pregunta o tema jurídico en español"),
        limite_por_fuente: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(4)
          .describe("Resultados por cada fuente"),
        formato: formatoSchema,
      },
    },
    async ({ consulta, limite_por_fuente, formato }) => {
      try {
        return okSearch(await searchTodas(consulta, limite_por_fuente), formato);
      } catch (error) {
        return fail(
          `Error en búsqueda unificada: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "acerca_de",
    {
      title: "Acerca de este conector MCP",
      description:
        "Información del servidor, fuentes utilizadas y cómo citar los resultados.",
      inputSchema: {},
    },
    async () =>
      okText(
        formatResultsJson({
          name: "MCP Legal Chile",
          version: "1.1.0",
          description:
            "Conector MCP del derecho chileno: legislación (texto oficial LeyChile), jurisprudencia, doctrina y dictámenes con citas verificables.",
          tools: [
            "buscar_legislacion",
            "obtener_norma",
            "obtener_texto_norma",
            "obtener_articulo",
            "buscar_jurisprudencia",
            "buscar_doctrina",
            "buscar_dictamenes",
            "buscar_derecho_chileno",
            "acerca_de",
          ],
          sources: [
            {
              id: "legislacion",
              name: "Legislación (BCN / LeyChile SPARQL + XML)",
              endpoint: "https://datos.bcn.cl/sparql",
              official: "https://www.bcn.cl/leychile/",
            },
            {
              id: "jurisprudencia",
              name: "Jurisprudencia (PJUD / TC)",
              official: "https://www.pjud.cl/portal-unificado-sentencias",
            },
            {
              id: "doctrina",
              name: "Doctrina académica (OpenAlex)",
              endpoint: "https://api.openalex.org/",
            },
            {
              id: "dictamenes",
              name: "Dictámenes (Contraloría)",
              official:
                "https://www.contraloria.cl/web/cgr/dictamenes-y-pronunciamientos-juridicos",
            },
          ],
          guidance: [
            "Cita siempre la URL oficial incluida en cada resultado.",
            "Para citar artículos, usa obtener_articulo con el idNorma.",
            "No inventes fallos, dictámenes ni normas.",
            "Este servidor no sustituye asesoría jurídica profesional.",
          ],
        }),
      ),
  );

  server.registerPrompt(
    "consulta_juridica_chile",
    {
      title: "Consulta jurídica chilena con fuentes",
      description:
        "Plantilla para responder una pregunta de derecho chileno usando solo fuentes verificables del conector MCP.",
      argsSchema: {
        pregunta: z.string().describe("Pregunta jurídica del usuario"),
      },
    },
    ({ pregunta }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Eres un asistente de derecho chileno. Debes basarte exclusivamente en resultados de las herramientas MCP Legal Chile.",
              "",
              `Pregunta: ${pregunta}`,
              "",
              "Procedimiento:",
              "1. Usa buscar_derecho_chileno o herramientas específicas.",
              "2. Si aparece una norma relevante, usa obtener_texto_norma u obtener_articulo.",
              "3. Responde en español, estructurado: marco normativo, jurisprudencia (si hay), doctrina (si hay), conclusión prudente.",
              "4. Cada afirmación relevante debe llevar cita + URL.",
              "5. Si no hay fuentes suficientes, dilo explícitamente. No inventes fallos ni artículos.",
              "6. Aclara que no constituye asesoría jurídica formal.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "citar_articulo_ley",
    {
      title: "Citar un artículo de ley chilena",
      description:
        "Guía al asistente para obtener y citar correctamente un artículo de una ley/decreto chileno.",
      argsSchema: {
        id_norma: z.string().describe("idNorma LeyChile"),
        articulo: z.string().describe("Número de artículo"),
      },
    },
    ({ id_norma, articulo }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Obtén el artículo ${articulo} de la norma idNorma=${id_norma} con la herramienta obtener_articulo.`,
              "Luego presenta:",
              "- Cita formal (tipo, número, artículo)",
              "- Texto oficial completo del artículo",
              "- URL de LeyChile",
              "No parafrasees el texto normativo salvo para una glosa breve posterior al texto oficial.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}
