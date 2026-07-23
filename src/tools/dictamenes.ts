import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  investigarTema,
  resolverDictamen,
  searchDictamenes,
  searchTodas,
} from "../sources/index.js";
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
      title: "Buscar dictamenes",
      description: "Contraloria / administracion (link_only).",
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
          `Error dictamenes: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "resolver_dictamen",
    {
      title: "Resolver dictamen por numero",
      description: "Deep-link / busqueda por numero de dictamen CGR.",
      inputSchema: {
        numero: z.string().min(1),
        formato: formatoSchema,
      },
    },
    async ({ numero, formato }) => {
      try {
        return okSearch(
          await timed("resolver_dictamen", () => resolverDictamen(numero)),
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
    "buscar_derecho_chileno",
    {
      title: "Busqueda unificada",
      description:
        "Fan-out con presupuesto de tiempo; puede devolver pendingSources.",
      inputSchema: {
        consulta: z.string().min(2),
        limite_por_fuente: z.number().int().min(1).max(10).default(4),
        formato: formatoSchema,
      },
    },
    async ({ consulta, limite_por_fuente, formato }) => {
      try {
        return okSearch(
          await timed("buscar_derecho_chileno", () =>
            searchTodas(consulta, limite_por_fuente),
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
      title: "Pack de investigacion juridica",
      description:
        "Orquesta legislacion/jurisprudencia/dictamenes/doctrina en <=~12s con resultados parciales OK. No entrega texto integro de fallos PJUD (link_only). Para detalle: citar_texto_legal / obtener_fallo_tc.",
      inputSchema: {
        consulta: z.string().min(2),
        limite_por_fuente: z.number().int().min(1).max(8).default(2),
      },
    },
    async ({ consulta, limite_por_fuente }) => {
      try {
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
