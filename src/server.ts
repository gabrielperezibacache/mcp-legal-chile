import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatChileanCitation } from "./citation.js";
import { runWithDeadline } from "./deadline.js";
import { formatSearchMarkdown } from "./format.js";
import { ANTI_HALLUCINATION_RULES, sealSearchResponse } from "./integrity.js";
import { metrics } from "./metrics.js";
import {
  citarJurisprudencia,
  citarTextoLegal,
  doctrineToMarkdown,
  formatDoctrineSearchMarkdown,
  estadoNorma,
  getNorma,
  investigarTema,
  normasRelacionadas,
  normaToPlainText,
  obtenerDoctrina,
  obtenerFalloTc,
  resolverDictamen,
  resolverRol,
  resolveRolToMarkdown,
  searchDictamenes,
  searchDoctrina,
  searchDoctrinaLatam,
  searchJurisprudencia,
  searchLegislacion,
  searchTodas,
  searchTribunalConstitucional,
} from "./sources/index.js";
import {
  ArticleNotFoundError,
  findIncisoOrLiteral,
  LeyChileRateLimitError,
  LeyChileXmlError,
  parseNormaTexto,
  requireArticulo,
  UnsupportedNormaStructureError,
} from "./sources/normaTexto.js";
import type { SearchResponse } from "./types.js";
import { formatResultsJson } from "./util.js";

const VERSION = "1.12.0";
/** Must exceed TC keyword latency (often 6–14s) without cascading into slow web scrape. */
const SEARCH_TOOL_TIMEOUT_MS = Number(
  process.env.SEARCH_TOOL_TIMEOUT_MS ?? 22_000,
);

const latamPaisSchema = z
  .enum(["PE", "BR", "AR", "MX", "CO"])
  .describe("País LATAM: PE, BR, AR, MX, CO");

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
  const sealed = sealSearchResponse(data);
  const text =
    formato === "json"
      ? formatResultsJson(sealed)
      : formatSearchMarkdown(sealed);
  return { content: [{ type: "text" as const, text }] };
}

function okText(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

function formatLegalExtractionError(error: unknown, idNorma: string): string {
  const code = idNorma.replace(/\D/g, "");
  const official = `https://www.bcn.cl/leychile/navegar?idNorma=${code}`;
  const xml = `https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=${code}`;
  const message = error instanceof Error ? error.message : String(error);
  const title =
    error instanceof ArticleNotFoundError
      ? "Artículo no encontrado."
      : error instanceof UnsupportedNormaStructureError
        ? "Formato XML no soportado por el parser."
        : error instanceof LeyChileXmlError
          ? "XML LeyChile inválido o no disponible."
          : error instanceof LeyChileRateLimitError
            ? "LeyChile rate-limit temporal (HTTP 429)."
            : "No se pudo extraer texto oficial desde LeyChile.";

  return [
    title,
    `Detalle: ${message}`,
    `Fuente oficial: ${official}`,
    `XML oficial: ${xml}`,
    "No inventes el contenido: verifica manualmente o usa obtener_texto_norma modo=indice para ver artículos detectados.",
  ].join("\n");
}

/** Soft 429: useful markdown without isError so MCP clients (e.g. Hermes) do not trip global unreachable. */
function legalExtractionFailure(error: unknown, idNorma: string) {
  const code = idNorma.replace(/\D/g, "");
  const official = `https://www.bcn.cl/leychile/navegar?idNorma=${code}`;
  if (error instanceof LeyChileRateLimitError) {
    const sec = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
    return okText(
      [
        "LeyChile está limitando temporalmente las solicitudes (HTTP 429).",
        `Reintenta en ~${sec}s. Mientras tanto usa la URL oficial (no inventes el texto).`,
        `Fuente oficial: ${official}`,
        `XML: https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=${code}`,
        `Detalle: ${error.message}`,
      ].join("\n"),
    );
  }
  return fail(formatLegalExtractionError(error, idNorma));
}

async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  metrics.markToolCall();
  return metrics.time("tool", () => metrics.time(name, fn));
}

async function timedSearch<T>(
  name: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return timed(name, () =>
    runWithDeadline(name, SEARCH_TOOL_TIMEOUT_MS, fn),
  );
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "mcp-legal-chile",
    version: VERSION,
  });

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
                  ? data.warnings.map((w) => `- _${w}_`)
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

  server.registerTool(
    "obtener_doctrina",
    {
      title: "Obtener doctrina por SciELO / DOI / OpenAlex",
      description:
        "Recupera una obra doctrinal con cita chilena, APA, abstract y enlaces SciELO/DOI/PDF.",
      inputSchema: {
        doi: z.string().optional(),
        openalex_id: z.string().optional(),
        scielo_pid: z
          .string()
          .optional()
          .describe("PID SciELO, ej. S0718-34372012000300019"),
        collection: z
          .enum(["chl", "scl", "arg", "mex", "per", "col"])
          .optional()
          .describe("Colección ArticleMeta SciELO (chl, scl, arg, mex, per, col)"),
        formato: formatoSchema,
      },
    },
    async ({ doi, openalex_id, scielo_pid, collection, formato }) => {
      try {
        const d = await timed("obtener_doctrina", () =>
          obtenerDoctrina({
            doi,
            openAlexId: openalex_id,
            scieloPid: scielo_pid,
            collection,
          }),
        );
        if (formato === "json") return okText(formatResultsJson(d));
        return okText(doctrineToMarkdown(d));
      } catch (error) {
        return fail(
          `Error obtener_doctrina: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

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
    async ({ consulta, limite, anio, competencia, tipo_resolucion, formato }) => {
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
        "Metadatos + extracto/doctrina + índice de considerandos. Si el ROL no está en el índice de texto del TC, cae a un resumen oficial de ficha (integridad metadata, marcado explícitamente). Para citar un considerando exacto usa citar_jurisprudencia.",
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
        "Cita formal (tribunal, tipo, ROL, año, considerando) + blockquote. Sin texto: API gratuita TC (si el ROL no está indexado, usa el resumen oficial de ficha e integridad=metadata; rechaza `considerando` en ese caso para no inventar). Con texto pegado: fallos PJUD u otros (sin APIs de pago).",
      inputSchema: {
        rol: z.string().min(3).describe("ROL, ej. 9666-2020 o 12345-2020"),
        texto: z
          .string()
          .optional()
          .describe(
            "Texto íntegro o considerandos pegados del fallo (requerido para PJUD / no-TC)",
          ),
        tribunal: z
          .string()
          .optional()
          .describe("Ej. Corte Suprema; default TC si no hay texto"),
        tipo_resolucion: z
          .string()
          .optional()
          .describe("Ej. Sentencia, Auto"),
        anio: z.string().optional(),
        url: z.string().optional().describe("URL oficial del fallo si la tienes"),
        considerando: z
          .string()
          .optional()
          .describe("Nº o rótulo: 15, 15º, décimo quinto"),
        consulta: z
          .string()
          .optional()
          .describe("Palabras clave para elegir el considerando más pertinente"),
        max_chars: z
          .number()
          .int()
          .min(200)
          .max(8000)
          .default(2500)
          .describe("Largo máximo del fragmento"),
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

  server.registerTool(
    "buscar_doctrina",
    {
      title: "Buscar doctrina jurídica chilena",
      description:
        "Doctrina OA gratis: OpenAlex (catálogo revistas CL) + DOAJ + Crossref + enrich ArticleMeta SciELO. Citas Chile/APA.",
      inputSchema: {
        consulta: z.string().min(2),
        limite: limitSchema,
        formato: formatoSchema,
      },
    },
    async ({ consulta, limite, formato }) => {
      try {
        const data = await timedSearch("buscar_doctrina", (signal) =>
          searchDoctrina(consulta, limite, { signal }),
        );
        if (formato === "json") {
          return okSearch(data, "json");
        }
        return okText(
          formatDoctrineSearchMarkdown(data, `Doctrina — ${consulta}`),
        );
      } catch (error) {
        return fail(
          `Error doctrina: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "buscar_doctrina_latam",
    {
      title: "Buscar doctrina jurídica LATAM",
      description:
        "Doctrina LATAM OA: catálogo ISSN + OpenAlex + DOAJ por país (PE/BR/AR/MX/CO).",
      inputSchema: {
        consulta: z.string().min(2),
        pais: latamPaisSchema,
        limite: limitSchema,
        formato: formatoSchema,
      },
    },
    async ({ consulta, pais, limite, formato }) => {
      try {
        const data = await timed("buscar_doctrina_latam", () =>
          searchDoctrinaLatam(consulta, limite, pais),
        );
        if (formato === "json") {
          return okSearch(data, "json");
        }
        return okText(
          formatDoctrineSearchMarkdown(
            data,
            `Doctrina ${pais} — ${consulta}`,
          ),
        );
      } catch (error) {
        return fail(
          `Error doctrina LATAM: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

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
      title: "Búsqueda unificada",
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
      title: "Pack de investigación jurídica",
      description:
        "Orquesta legislación/jurisprudencia/dictámenes/doctrina en ≤~12s con resultados parciales OK. No entrega texto íntegro de fallos PJUD (link_only). Para detalle: citar_texto_legal / obtener_fallo_tc.",
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

  server.registerTool(
    "acerca_de",
    {
      title: "Acerca de MCP Legal Chile",
      description: "Catálogo, matriz de honestidad y SLOs.",
      inputSchema: {},
    },
    async () =>
      okText(
        formatResultsJson({
          name: "MCP Legal Chile",
          version: VERSION,
          honestyMatrix: {
            obtener_articulo: "verified / full_text (LeyChile XML)",
            obtener_texto_norma: "verified / full_text (LeyChile XML)",
            obtener_inciso: "verified / full_text heurístico",
            citar_texto_legal: "verified / full_text + cita formal",
            citar_jurisprudencia:
              "verified (full_text) si TC indexado o texto pegado; metadata (resumen ficha) si el ROL no está en el índice de texto TC; rechaza considerando inexistente",
            buscar_legislacion: "candidate / metadata BCN",
            normas_relacionadas:
              "candidate / metadata BCN (predicados estructurados: modifica/modificada por/refunde/rectificada por/regulada por/concuerda con)",
            buscar_jurisprudencia:
              "candidate o portal_stub (nunca afirmar ratio desde links)",
            buscar_tc: "candidate / TC API metadata + PDF",
            resolver_rol: "candidate / portales + TC",
            obtener_fallo_tc:
              "verified extracto + índice considerandos; metadata (solo ficha/doctrina) si el ROL no está en el índice de texto TC",
            buscar_dictamenes: "candidate / link_only (verificar CGR)",
            buscar_doctrina: "candidate / metadata OA (no vinculante)",
            buscar_doctrina_latam: "candidate / metadata OA LATAM",
            obtener_doctrina: "candidate / ArticleMeta SciELO-DOI-OpenAlex",
          },
          integrityLevels: {
            verified: "texto/fuente oficial recuperada por el MCP",
            candidate: "metadato o enlace a verificar; no afirmar contenido",
            portal_stub: "solo portal de búsqueda; NO es un documento encontrado",
          },
          slo: metrics.snapshot().slo,
          guidance: [...ANTI_HALLUCINATION_RULES],
        }),
      ),
  );

  server.registerPrompt(
    "consulta_juridica_chile",
    {
      title: "Consulta jurídica chilena con fuentes",
      description: "Responde solo con tools MCP Legal Chile.",
      argsSchema: { pregunta: z.string() },
    },
    ({ pregunta }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Usa preferentemente investigar_tema, luego obtener_articulo/obtener_inciso según haga falta.",
              `Pregunta: ${pregunta}`,
              "Cita URL siempre. Indica integrity/evidencia. Si link_only o portal_stub, no afirmes contenido.",
              "Prohibido inventar ROL, dictámenes, artículos o considerandos no devueltos por las tools.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "citar_articulo_ley",
    {
      title: "Citar artículo de ley chilena",
      description: "Obtiene y formatea un artículo oficial.",
      argsSchema: {
        id_norma: z.string(),
        articulo: z.string(),
      },
    },
    ({ id_norma, articulo }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Usa obtener_articulo (id_norma=${id_norma}, articulo=${articulo}) y formatear_cita. Presenta texto oficial + cita + URL.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "memo_asesoria",
    {
      title: "Memo de asesoría (IRAC)",
      description: "Estructura IRAC con citas obligatorias de tools.",
      argsSchema: { tema: z.string() },
    },
    ({ tema }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Redacta un memo IRAC sobre: ${tema}`,
              "1) investigar_tema",
              "2) obtener_articulo de normas clave",
              "3) Hechos / Issue / Rule (con citas URL) / Application / Conclusion",
              "4) Sección 'Qué falta verificar' si hay link_only",
              "Aclara que no es asesoría formal.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "checklist_recurso_proteccion",
    {
      title: "Checklist recurso de protección",
      description: "Pasos y tools a invocar antes de redactar.",
      argsSchema: { hechos: z.string() },
    },
    ({ hechos }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Hechos preliminares: ${hechos}`,
              "Checklist: (1) art. 20 CPR vía obtener_articulo idNorma 242302",
              "(2) garantías involucradas art. 19",
              "(3) buscar_jurisprudencia / buscar_tc; ROL TC → obtener_fallo_tc / citar_jurisprudencia; PJUD → pegar texto en citar_jurisprudencia",
              "(4) lista de pruebas y plazos — sin inventar jurisprudencia",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "checklist_demanda_laboral",
    {
      title: "Checklist demanda laboral",
      description: "Normas CT + jurisprudencia a verificar.",
      argsSchema: { materia: z.string() },
    },
    ({ materia }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Materia laboral: ${materia}`,
              "1) buscar_legislacion Código del Trabajo / obtener_articulo",
              "2) buscar_jurisprudencia con filtros",
              "3) Listar pretensiones y normas citables con URL",
              "No inventes ROL ni montos.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "lista_prueba_normativa",
    {
      title: "Lista de prueba normativa",
      description: "Qué artículos pedir antes de redactar.",
      argsSchema: { tema: z.string() },
    },
    ({ tema }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Para redactar sobre "${tema}", usa investigar_tema y produce una checklist de idNorma+artículo a obtener_articulo antes de escribir.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "citar_doctrina_y_norma",
    {
      title: "Citar doctrina + texto legal",
      description:
        "Combina cita doctrinal formal con blockquote del artículo oficial de LeyChile.",
      argsSchema: {
        tema: z.string(),
        id_norma: z.string().optional(),
        articulo: z.string().optional(),
      },
    },
    ({ tema, id_norma, articulo }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Tema: ${tema}`,
              "1) buscar_doctrina y, si hay DOI, obtener_doctrina",
              id_norma && articulo
                ? `2) citar_texto_legal id_norma=${id_norma} articulo=${articulo}`
                : "2) buscar_legislacion y luego citar_texto_legal del artículo más pertinente",
              "3) Entregar: (A) citas doctrinales Chile/APA (B) blockquote del texto legal (C) párrafo que las articule sin inventar.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}

export { VERSION };
