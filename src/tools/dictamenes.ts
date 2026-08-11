import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  investigarTema,
  resolverDictamenDt,
  resolverDictamen,
  searchAdministrativo,
  searchCmf,
  searchDictamenes,
  searchDictamenesDt,
  searchRegulatorioOrganismo,
  searchSernac,
  searchTodas,
} from "../sources/index.js";
import { citarDictamenPegado } from "../sources/dictamenQuote.js";
import { formatResultsJson } from "../util.js";
import {
  formatoSchema,
  limitSchema,
  okSearch,
  okText,
  READ_ONLY_ANNOTATIONS,
  reportToolProgress,
  softAgencyFailure,
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
        return softAgencyFailure(error, "Error dictámenes");
      }
    },
  );

  server.registerTool(
    "buscar_dictamenes_dt",
    {
      title: "Buscar dictámenes de la Dirección del Trabajo",
      description:
        "Busca Ord./dictámenes DT en el portal oficial y sitios públicos; el cuerpo es verified solo si se recupera extracto HTML usable.",
      inputSchema: {
        consulta: z.string().min(2),
        limite: limitSchema,
        formato: formatoSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ consulta, limite, formato }) => {
      try {
        return okSearch(
          await timedSearch("buscar_dictamenes_dt", (signal) =>
            searchDictamenesDt(consulta, limite, { signal }),
          ),
          formato,
        );
      } catch (error) {
        return softAgencyFailure(error, "Error dictámenes DT");
      }
    },
  );

  server.registerTool(
    "resolver_dictamen_dt",
    {
      title: "Resolver dictamen DT por número",
      description:
        "Construye el enlace y busca un Ord./dictamen de la Dirección del Trabajo por número.",
      inputSchema: {
        numero: z.string().min(1),
        formato: formatoSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ numero, formato }) => {
      try {
        return okSearch(
          await timedSearch("resolver_dictamen_dt", () =>
            resolverDictamenDt(numero),
          ),
          formato,
        );
      } catch (error) {
        return softAgencyFailure(error, "Error resolver_dictamen_dt");
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
        return softAgencyFailure(error, "Error administrativo");
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
        return softAgencyFailure(error, "Error resolver_dictamen");
      }
    },
  );

  server.registerTool(
    "buscar_circulares_sernac",
    {
      title: "Buscar circulares y actos SERNAC",
      description:
        "Busca actos públicos de SERNAC. Resultados de portal o metadata son candidate/link_only salvo extracto HTML usable.",
      inputSchema: {
        consulta: z.string().min(2),
        limite: limitSchema,
        formato: formatoSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ consulta, limite, formato }) => {
      try {
        return okSearch(
          await timedSearch("buscar_circulares_sernac", (signal) =>
            searchSernac(consulta, limite, { signal }),
          ),
          formato,
        );
      } catch (error) {
        return softAgencyFailure(error, "Error buscar_circulares_sernac");
      }
    },
  );

  server.registerTool(
    "buscar_circulares_cmf",
    {
      title: "Buscar circulares y actos CMF",
      description:
        "Busca circulares, oficios y resoluciones públicas de la CMF con clasificación de integridad.",
      inputSchema: {
        consulta: z.string().min(2),
        limite: limitSchema,
        formato: formatoSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ consulta, limite, formato }) => {
      try {
        return okSearch(
          await timedSearch("buscar_circulares_cmf", (signal) =>
            searchCmf(consulta, limite, { signal }),
          ),
          formato,
        );
      } catch (error) {
        return softAgencyFailure(error, "Error buscar_circulares_cmf");
      }
    },
  );

  server.registerTool(
    "buscar_regulatorio",
    {
      title: "Buscar acto regulatorio",
      description:
        "Busca actos regulatorios de SERNAC o CMF mediante sus portales y web pública.",
      inputSchema: {
        organismo: z.enum(["sernac", "cmf"]),
        consulta: z.string().min(2),
        limite: limitSchema,
        formato: formatoSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ organismo, consulta, limite, formato }) => {
      try {
        return okSearch(
          await timedSearch("buscar_regulatorio", (signal) =>
            searchRegulatorioOrganismo(organismo, consulta, limite, { signal }),
          ),
          formato,
        );
      } catch (error) {
        return softAgencyFailure(error, "Error buscar_regulatorio");
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
        max_chars: z.number().int().min(200).max(8000).default(2500),
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
        return softAgencyFailure(error, "Error citar_dictamen_pegado");
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
        return softAgencyFailure(error, "Error unificada");
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
        area: z
          .enum([
            "constitucional",
            "civil",
            "laboral",
            "penal",
            "administrativo",
            "consumidor",
            "ambiental",
            "procesal",
            "general",
          ])
          .optional(),
        perfil: z.enum(["fast", "default", "deep"]).default("default"),
      },
    },
    async ({ consulta, limite_por_fuente, area, perfil }, extra) => {
      try {
        // Pack has a hard internal PACK_TOTAL_MS budget (~18s).
        const text = await timed("investigar_tema", () =>
          investigarTema(consulta, limite_por_fuente, {
            area,
            perfil,
            onProgress: (progress, total, message) =>
              reportToolProgress(extra, progress, total, message),
          }),
        );
        return okText(text);
      } catch (error) {
        return softAgencyFailure(error, "Error investigar_tema");
      }
    },
  );
}
