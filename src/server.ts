import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatChileanCitation } from "./citation.js";
import { formatSearchMarkdown } from "./format.js";
import { metrics } from "./metrics.js";
import {
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
  findArticulo,
  findIncisoOrLiteral,
  FragmentNotFoundError,
  parseNormaTexto,
} from "./sources/normaTexto.js";
import type { SearchResponse } from "./types.js";
import { formatResultsJson } from "./util.js";

const VERSION = "1.7.0";

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
  const text =
    formato === "json" ? formatResultsJson(data) : formatSearchMarkdown(data);
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

async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  metrics.markToolCall();
  return metrics.time("tool", () => metrics.time(name, fn));
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
        "Busca normativa chilena en BCN / LeyChile. Para texto íntegro usa obtener_texto_norma / obtener_articulo.",
      inputSchema: {
        consulta: z.string().min(2),
        limite: limitSchema,
        formato: formatoSchema,
      },
    },
    async ({ consulta, limite, formato }) => {
      try {
        return okSearch(
          await timed("buscar_legislacion", () =>
            searchLegislacion(consulta, limite),
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
        "Candidatas relacionadas por similitud BCN + enlace a historia LeyChile.",
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
        max_chars: z.number().int().min(1000).max(50_000).default(12_000),
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
        const msg = error instanceof Error ? error.message : String(error);
        const code = id_norma.replace(/\D/g, "");
        return okText(
          [
            `No se pudo descargar el XML de LeyChile para idNorma=${code}.`,
            `Detalle: ${msg}`,
            `- https://www.bcn.cl/leychile/navegar?idNorma=${code}`,
            `- https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=${code}`,
            "No inventes el texto de la norma.",
          ].join("\n"),
        );
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
        const art = findArticulo(norma, articulo);
        if (!art) {
          return fail(
            `No se encontró el artículo ${articulo}. Disponibles: ${norma.articulos
              .map((a) => a.numero)
              .slice(0, 40)
              .join(", ")}`,
          );
        }
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
        const msg = error instanceof Error ? error.message : String(error);
        const code = id_norma.replace(/\D/g, "");
        return okText(
          [
            `No se pudo obtener el artículo ${articulo} (idNorma=${code}).`,
            `Detalle: ${msg}`,
            `- https://www.bcn.cl/leychile/navegar?idNorma=${code}`,
            "No inventes el contenido del artículo.",
          ].join("\n"),
        );
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
        const art = findArticulo(norma, articulo);
        if (!art) return fail(`No se encontró el artículo ${articulo}.`);
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
        if (error instanceof FragmentNotFoundError) {
          return fail(error.message);
        }
        return fail(
          `Error obtener_inciso: ${error instanceof Error ? error.message : String(error)}`,
        );
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
        if (error instanceof FragmentNotFoundError) {
          return fail(error.message);
        }
        return fail(
          `Error citar_texto_legal: ${error instanceof Error ? error.message : String(error)}`,
        );
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
        "Links a fallos PJUD/TC (evidencia link_only). Filtros opcionales anio/tribunal.",
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
          await timed("buscar_jurisprudencia", () =>
            searchJurisprudencia(consulta, limite, {
              anio,
              tribunal,
              soloOficiales: solo_urls_oficiales,
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
        formato: formatoSchema,
      },
    },
    async ({ consulta, limite, formato }) => {
      try {
        return okSearch(
          await timed("buscar_tc", () =>
            searchTribunalConstitucional(consulta, limite),
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
        const data = await timed("resolver_rol", () =>
          resolverRol({ rol, tribunal, anio, limite }),
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
        "Metadatos + extracto/doctrina + blockquote desde buscador oficial TC (PDF enlazado).",
      inputSchema: {
        rol: z.string().min(3).describe("ROL TC, ej. 9666-20 o 9666-2020"),
        formato: formatoSchema,
      },
    },
    async ({ rol, formato }) => {
      try {
        const pack = await timed("obtener_fallo_tc", () => obtenerFalloTc(rol));
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
    "buscar_doctrina",
    {
      title: "Buscar doctrina jurídica chilena",
      description:
        "SciELO Chile (revistas jurídicas) + OpenAlex + Crossref con citas Chile/APA, DOI, abstract y PDF.",
      inputSchema: {
        consulta: z.string().min(2),
        limite: limitSchema,
        formato: formatoSchema,
      },
    },
    async ({ consulta, limite, formato }) => {
      try {
        const data = await timed("buscar_doctrina", () =>
          searchDoctrina(consulta, limite),
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
        "Revistas de referencia por país (PE, BR, AR, MX, CO): catálogo ISSN + OpenAlex + enlaces SciELO/OJS.",
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
          await timed("buscar_dictamenes", () =>
            searchDictamenes(consulta, limite),
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
        "Orquesta legislación (+ artículo si aplica), jurisprudencia, dictámenes y doctrina en un memo markdown anti-alucinación.",
      inputSchema: {
        consulta: z.string().min(2),
        limite_por_fuente: z.number().int().min(1).max(8).default(3),
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
            obtener_articulo: "full_text (LeyChile XML)",
            obtener_texto_norma: "full_text (LeyChile XML)",
            obtener_inciso: "full_text heurístico",
            citar_texto_legal: "full_text + cita formal + blockquote",
            buscar_legislacion: "metadata BCN",
            buscar_jurisprudencia: "PJUD link_only",
            buscar_tc: "TC API metadata + PDF",
            resolver_rol: "portales + TC API / PJUD search",
            obtener_fallo_tc: "TC extracto + blockquote oficial",
            buscar_dictamenes: "link_only",
            buscar_doctrina: "SciELO Chile (22 rev.) + OpenAlex + Crossref",
            buscar_doctrina_latam: "Catálogo ISSN PE/BR/AR/MX/CO + OpenAlex",
            obtener_doctrina: "ArticleMeta SciELO multi-país / DOI / OpenAlex",
          },
          slo: metrics.snapshot().slo,
          guidance: [
            "No inventes fallos, dictámenes ni artículos.",
            "Si evidence=link_only, no afirmes el contenido del documento.",
            "No sustituye asesoría jurídica profesional.",
          ],
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
              "Cita URL siempre. Si evidence=link_only, dilo. No inventes fuentes.",
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
              "(3) buscar_jurisprudencia (PJUD link_only) o buscar_tc; si hay ROL TC usar obtener_fallo_tc",
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
