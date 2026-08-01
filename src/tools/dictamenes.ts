import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  investigarTema,
  resolverDictamen,
  searchAdministrativo,
  searchDictamenes,
  searchTodas,
} from "../sources/index.js";
import { citarDictamenPegado } from "../sources/dictamenQuote.js";
import { formatResultsJson } from "../util.js";
import {
  fail,
  formatoSchema,
  limitSchema,
  okSearch,
  okText,
  timed,
  timedSearch,
} from "./helpers.js";

export function registerDictamenesTools(server: McpServer): void {
  server.registerTool(
    "buscar_dictamenes",
    {
      title: "Buscar dictámenes",
      description: "Contraloría / administración (link_only).",
      inputSchema: {
        consulta: z.string().min(2),
        limite: limitSchema,
        formato: formatoSchema,
      },
    },
    async ({ consulta, limite, formato }) => {
      try {
        return okSearch(
          await timedSearch("buscar_dictamenes", (signal) =>
            searchDictamenes(consulta, limite, { signal }),
          ),
          formato,
        );
      } catch (error) {
        return fail(
          `Error dictámenes: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "buscar_administrativo",
    {
      title: "Buscar normativa administrativa (superintendencias)",
      description:
        "CMF, Superintendencia de Salud, SUSESO, SEC, SUPERIR y otros organismos sin API pública (portal_stub + link_only).",
      inputSchema: {
        consulta: z.string().min(2),
        limite: limitSchema,
        formato: formatoSchema,
      },
    },
    async ({ consulta, limite, formato }) => {
      try {
        return okSearch(
          await timedSearch("buscar_administrativo", (signal) =>
            searchAdministrativo(consulta, limite, { signal }),
          ),
          formato,
        );
      } catch (error) {
        return fail(
          `Error administrativo: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "resolver_dictamen",
    {
      title: "Resolver dictamen por número",
      description:
        "Deep-link / búsqueda por número de dictamen CGR (link_only). Para citar texto pegado usa `citar_dictamen_pegado`.",
      inputSchema: {
        numero: z.string().min(1),
        formato: formatoSchema,
      },
    },
    async ({ numero, formato }) => {
      try {
        return okSearch(
          await timedSearch("resolver_dictamen", (signal) =>
            resolverDictamen(numero, { signal }),
          ),
          formato,
        );
      } catch (error) {
        return fail(
          `Error resolver_dictamen: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "citar_dictamen_pegado",
    {
      title: "Citar dictamen CGR con texto pegado",
      description:
        "Flujo de estudio: pega el texto del dictamen desde el portal CGR y obtén cita formal + blockquote. No descarga el cuerpo automáticamente (CGR sin API de texto).",
      inputSchema: {
        numero: z.string().min(1).describe("Ej. 12345N20 o 12.345/2020"),
        texto: z
          .string()
          .min(60)
          .describe("Texto íntegro o parte resolutiva pegada del dictamen"),
        url: z.string().optional().describe("URL oficial si la tienes"),
        organo: z
          .string()
          .optional()
          .describe("Default: Contraloría General de la República"),
        max_chars: z
          .number()
          .int()
          .min(200)
          .max(8000)
          .default(2500),
        formato: formatoSchema,
      },
    },
    async ({ numero, texto, url, organo, max_chars, formato }) => {
      try {
        const quote = citarDictamenPegado({
          numero,
          texto,
          url,
          organo,
          maxChars: max_chars,
        });
        if (formato === "json") return okText(formatResultsJson(quote));
        return okText(quote.markdown);
      } catch (error) {
        return fail(
          `Error citar_dictamen_pegado: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "buscar_derecho_chileno",
    {
      title: "Búsqueda unificada",
      description:
        "Fan-out con presupuesto de tiempo (~8s); puede devolver pendingSources.",
      inputSchema: {
        consulta: z.string().min(2),
        limite_por_fuente: z.number().int().min(1).max(10).default(4),
        formato: formatoSchema,
      },
    },
    async ({ consulta, limite_por_fuente, formato }) => {
      try {
        return okSearch(
          await timedSearch("buscar_derecho_chileno", (signal) =>
            searchTodas(consulta, limite_por_fuente, undefined, signal),
          ),
          formato,
        );
      } catch (error) {
        return fail(
          `Error unificada: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "investigar_tema",
    {
      title: "Pack de investigación jurídica",
      description:
        "Orquesta legislación/jurisprudencia/dictámenes/doctrina en <=~18s (PACK_TOTAL_MS) con resultados parciales OK. Formato fijo: fuentes + Verificado/Por verificar/Portales + Próximos pasos. No entrega texto íntegro de fallos PJUD (link_only): usa pegar_fallo_pjud. Para detalle: citar_texto_legal / obtener_fallo_tc / flujo_estudio.",
      inputSchema: {
        consulta: z.string().min(2),
        limite_por_fuente: z.number().int().min(1).max(8).default(2),
      },
    },
    async ({ consulta, limite_por_fuente }) => {
      try {
        // Pack has a hard internal PACK_TOTAL_MS budget (~18s).
        const text = await timed("investigar_tema", () =>
          investigarTema(consulta, limite_por_fuente),
        );
        return okText(text);
      } catch (error) {
        return fail(
          `Error investigar_tema: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
