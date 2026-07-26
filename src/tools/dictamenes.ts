import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  investigarTema,
  resolverDictamen,
  searchAdministrativo,
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
      description: "Deep-link / búsqueda por número de dictamen CGR.",
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
        "Orquesta legislación/jurisprudencia/dictámenes/doctrina en <=~18s (PACK_TOTAL_MS) con resultados parciales OK. No entrega texto íntegro de fallos PJUD (link_only). Para detalle: citar_texto_legal / obtener_fallo_tc.",
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
