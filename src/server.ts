import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getNorma,
  searchDictamenes,
  searchDoctrina,
  searchJurisprudencia,
  searchLegislacion,
  searchTodas,
} from "./sources/index.js";
import { formatResultsJson } from "./util.js";

const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(20)
  .default(8)
  .describe("Cantidad máxima de resultados (1-20)");

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: formatResultsJson(data) }],
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
    version: "1.0.0",
  });

  server.registerTool(
    "buscar_legislacion",
    {
      title: "Buscar legislación chilena",
      description:
        "Busca normativa chilena vigente en los datos abiertos de la BCN / LeyChile (leyes, decretos, resoluciones). Devuelve título, cita y enlace oficial a LeyChile.",
      inputSchema: {
        consulta: z
          .string()
          .min(2)
          .describe(
            "Términos de búsqueda, p. ej. 'protección de datos', 'código del trabajo', 'ley 19.628'",
          ),
        limite: limitSchema,
      },
    },
    async ({ consulta, limite }) => {
      try {
        return ok(await searchLegislacion(consulta, limite));
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
      },
    },
    async ({ id_norma, numero, consulta }) => {
      try {
        return ok(
          await getNorma({
            leychileCode: id_norma,
            number: numero,
            query: consulta,
          }),
        );
      } catch (error) {
        return fail(
          `Error al obtener norma: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "buscar_jurisprudencia",
    {
      title: "Buscar jurisprudencia chilena",
      description:
        "Busca sentencias y fallos relacionados con derecho chileno (Poder Judicial, Tribunal Constitucional y fuentes indexadas). Siempre incluye URLs para verificación.",
      inputSchema: {
        consulta: z
          .string()
          .min(2)
          .describe(
            "Tema o criterios del fallo, p. ej. 'despido injustificado', 'recurso de protección salud'",
          ),
        limite: limitSchema,
      },
    },
    async ({ consulta, limite }) => {
      try {
        return ok(await searchJurisprudencia(consulta, limite));
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
      },
    },
    async ({ consulta, limite }) => {
      try {
        return ok(await searchDoctrina(consulta, limite));
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
        "Busca dictámenes y pronunciamientos de órganos de la administración del Estado (p. ej. Contraloría General de la República) con enlaces públicos.",
      inputSchema: {
        consulta: z
          .string()
          .min(2)
          .describe(
            "Tema del dictamen, p. ej. 'viáticos funcionarios', 'licitación pública'",
          ),
        limite: limitSchema,
      },
    },
    async ({ consulta, limite }) => {
      try {
        return ok(await searchDictamenes(consulta, limite));
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
        "Consulta simultánea en legislación (LeyChile/BCN), jurisprudencia, doctrina y dictámenes. Ideal como primera pasada para una pregunta jurídica chilena.",
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
      },
    },
    async ({ consulta, limite_por_fuente }) => {
      try {
        return ok(await searchTodas(consulta, limite_por_fuente));
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
      ok({
        name: "MCP Legal Chile",
        version: "1.0.0",
        description:
          "Conector MCP inspirado en productos como Trifolia: expone herramientas para consultar derecho chileno con citas y enlaces oficiales o académicos verificables.",
        sources: [
          {
            id: "legislacion",
            name: "Legislación (BCN / LeyChile)",
            endpoint: "https://datos.bcn.cl/sparql",
            official: "https://www.bcn.cl/leychile/",
          },
          {
            id: "jurisprudencia",
            name: "Jurisprudencia (PJUD / TC + índices públicos)",
            official: "https://www.pjud.cl/portal-unificado-sentencias",
          },
          {
            id: "doctrina",
            name: "Doctrina académica (OpenAlex / revistas chilenas)",
            endpoint: "https://api.openalex.org/",
          },
          {
            id: "dictamenes",
            name: "Dictámenes (Contraloría y administración)",
            official:
              "https://www.contraloria.cl/web/cgr/dictamenes-y-pronunciamientos-juridicos",
          },
        ],
        guidance: [
          "Cita siempre la URL oficial incluida en cada resultado.",
          "No inventes fallos, dictámenes ni normas: usa solo lo devuelto por las herramientas.",
          "Este servidor no sustituye asesoría jurídica profesional.",
        ],
      }),
  );

  return server;
}
