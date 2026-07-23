import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  citarJurisprudencia,
  obtenerFalloTc,
  resolverRol,
  resolveRolToMarkdown,
  searchJurisprudencia,
  searchTribunalConstitucional,
} from "../sources/index.js";
import { formatResultsJson } from "../util.js";
import {
  fail,
  formatoSchema,
  limitSchema,
  okSearch,
  okText,
  timedSearch,
} from "./helpers.js";

export function registerJurisprudenciaTools(server: McpServer): void {
  server.registerTool(
    "buscar_jurisprudencia",
    {
      title: "Buscar jurisprudencia chilena",
      description:
        "Jurisprudencia chilena (TC API + PJUD/web). Ranking por relevancia, filtros anio/tribunal; evidencia link_only salvo TC.",
      inputSchema: {
        consulta: z.string().min(2),
        limite: limitSchema,
        anio: z.string().optional(),
        tribunal: z.string().optional(),
        solo_urls_oficiales: z.boolean().default(true),
        formato: formatoSchema,
      },
    },
    async ({
      consulta,
      limite,
      anio,
      tribunal,
      solo_urls_oficiales,
      formato,
    }) => {
      try {
        return okSearch(
          await timedSearch("buscar_jurisprudencia", (signal) =>
            searchJurisprudencia(consulta, limite, {
              anio,
              tribunal,
              soloOficiales: solo_urls_oficiales,
              signal,
            }),
          ),
          formato,
        );
      } catch (error) {
        return fail(
          `Error jurisprudencia: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "buscar_tc",
    {
      title: "Buscar Tribunal Constitucional",
      description:
        "API oficial buscador.tcchile.cl: metadatos, PDF y extracto. Usa obtener_fallo_tc para blockquote.",
      inputSchema: {
        consulta: z.string().min(2),
        limite: limitSchema,
        anio: z.string().optional().describe("Filtrar por año del fallo"),
        competencia: z
          .string()
          .optional()
          .describe("Ej. inaplicabilidad, inconstitucionalidad"),
        tipo_resolucion: z
          .string()
          .optional()
          .describe("Ej. Sentencia, Resolución"),
        formato: formatoSchema,
      },
    },
    async ({
      consulta,
      limite,
      anio,
      competencia,
      tipo_resolucion,
      formato,
    }) => {
      try {
        return okSearch(
          await timedSearch("buscar_tc", (signal) =>
            searchTribunalConstitucional(consulta, limite, {
              signal,
              anio,
              competencia,
              tipoResolucion: tipo_resolucion,
            }),
          ),
          formato,
        );
      } catch (error) {
        return fail(
          `Error buscar_tc: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "resolver_rol",
    {
      title: "Resolver ROL a enlaces oficiales",
      description:
        "Dado ROL (+ tribunal opcional): portales PJUD/TC y candidatos. TC vía API buscador.tcchile.cl.",
      inputSchema: {
        rol: z.string().min(3).describe("Ej. 9666-2020 o 12345-2020"),
        tribunal: z.string().optional(),
        anio: z.string().optional(),
        limite: limitSchema,
        formato: formatoSchema,
      },
    },
    async ({ rol, tribunal, anio, limite, formato }) => {
      try {
        const data = await timedSearch("resolver_rol", (signal) =>
          resolverRol({ rol, tribunal, anio, limite, signal }),
        );
        if (formato === "json") return okText(formatResultsJson(data));
        return okText(resolveRolToMarkdown(data));
      } catch (error) {
        return fail(
          `Error resolver_rol: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "obtener_fallo_tc",
    {
      title: "Obtener fallo del Tribunal Constitucional",
      description:
        "Metadatos + extracto/doctrina + indice de considerandos. Si el ROL no esta en el indice de texto del TC, cae a un resumen oficial de ficha (integridad metadata, marcado explicitamente). Para citar un considerando exacto usa citar_jurisprudencia.",
      inputSchema: {
        rol: z.string().min(3).describe("ROL TC, ej. 9666-20 o 9666-2020"),
        formato: formatoSchema,
      },
    },
    async ({ rol, formato }) => {
      try {
        const pack = await timedSearch("obtener_fallo_tc", (signal) =>
          obtenerFalloTc(rol, signal),
        );
        if (formato === "json") return okText(formatResultsJson(pack));
        return okText(pack.markdown);
      } catch (error) {
        return fail(
          `Error obtener_fallo_tc: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "citar_jurisprudencia",
    {
      title: "Citar fragmento exacto de jurisprudencia",
      description:
        "Cita formal (tribunal, tipo, ROL, ano, considerando) + blockquote. Sin texto: API gratuita TC (si el ROL no esta indexado, usa el resumen oficial de ficha e integridad=metadata; rechaza considerando en ese caso para no inventar). Con texto pegado: fallos PJUD u otros (sin APIs de pago).",
      inputSchema: {
        rol: z.string().min(3).describe("ROL, ej. 9666-2020 o 12345-2020"),
        texto: z
          .string()
          .optional()
          .describe(
            "Texto integro o considerandos pegados del fallo (requerido para PJUD / no-TC)",
          ),
        tribunal: z
          .string()
          .optional()
          .describe("Ej. Corte Suprema; default TC si no hay texto"),
        tipo_resolucion: z.string().optional().describe("Ej. Sentencia, Auto"),
        anio: z.string().optional(),
        url: z
          .string()
          .optional()
          .describe("URL oficial del fallo si la tienes"),
        considerando: z
          .string()
          .optional()
          .describe("Numero o rotulo: 15, 15o, decimo quinto"),
        consulta: z
          .string()
          .optional()
          .describe(
            "Palabras clave para elegir el considerando mas pertinente",
          ),
        max_chars: z
          .number()
          .int()
          .min(200)
          .max(8000)
          .default(2500)
          .describe("Largo maximo del fragmento"),
        formato: formatoSchema,
      },
    },
    async ({
      rol,
      texto,
      tribunal,
      tipo_resolucion,
      anio,
      url,
      considerando,
      consulta,
      max_chars,
      formato,
    }) => {
      try {
        const quote = await timedSearch("citar_jurisprudencia", (signal) =>
          citarJurisprudencia({
            rol,
            texto,
            tribunal,
            tipoResolucion: tipo_resolucion,
            anio,
            url,
            considerando,
            consulta,
            maxChars: max_chars,
            signal,
          }),
        );
        if (formato === "json") return okText(formatResultsJson(quote));
        return okText(quote.markdown);
      } catch (error) {
        return fail(
          `Error citar_jurisprudencia: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
