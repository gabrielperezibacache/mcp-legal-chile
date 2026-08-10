import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatChileanCitation } from "../citation.js";
import {
  citarTextoLegal,
  investigarNormaRelacionada,
  searchReglamentos,
  searchLegislacion,
  searchTratados,
  getNorma,
  estadoNorma,
  normasRelacionadas,
  verificarCita,
} from "../sources/index.js";
import {
  compararVersionNorma,
  listarNormasFrecuentes as listarNormasFrecuentesMapa,
  mapaNorma,
  resolverNormaFrecuente as resolverNormaFrecuenteMapa,
} from "../sources/normaMapa.js";
import {
  findIncisoOrLiteral,
  normaToPlainText,
  parseNormaTexto,
  requireArticulo,
} from "../sources/normaTexto.js";
import { CircuitOpenError } from "../upstream.js";
import { formatResultsJson } from "../util.js";
import {
  fail,
  formatoSchema,
  legalExtractionFailure,
  limitSchema,
  READ_ONLY_ANNOTATIONS,
  okSearch,
  okText,
  timedSearch,
} from "./helpers.js";

/** Soft-degrade open circuits for BCN metadata tools (no Hermes global cooldown). */
function softBcnFailure(error: unknown, label: string) {
  if (error instanceof CircuitOpenError) {
    const sec = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
    return okText(
      [
        `${label}: circuito ${error.host} temporalmente abierto.`,
        `Reintenta en ~${sec}s. No inventes normas ni idNorma.`,
        `Detalle: ${error.message}`,
      ].join("\n"),
    );
  }
  return fail(
    `${label}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

export function registerLegislacionTools(server: McpServer): void {
  server.registerTool(
    "resolver_norma_frecuente",
    {
      title: "Resolver norma frecuente (catálogo local)",
      description:
        "Resuelve aliases locales (CT, CPR, CPC, 19.880, etc.) a idNorma + URL LeyChile sin llamar a BCN. Luego usa obtener_articulo / citar_texto_legal. integrity candidate hasta obtener XML.",
      inputSchema: {
        consulta: z.string().min(2),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ consulta }) => {
      try {
        return okText(resolverNormaFrecuenteMapa(consulta).markdown);
      } catch (error) {
        return fail(
          `Error resolver_norma_frecuente: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "listar_normas_frecuentes",
    {
      title: "Listar normas frecuentes del catálogo",
      description:
        "Lista el catálogo hot local (idNorma, URL, aliases). No consulta BCN.",
      inputSchema: {
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
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ area }) =>
      okText(
        area
          ? listarNormasFrecuentesMapa(area).markdown
          : listarNormasFrecuentesMapa().markdown,
      ),
  );

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
        return softBcnFailure(error, "Error al buscar legislación");
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
          await timedSearch("obtener_norma", (signal) =>
            getNorma({
              leychileCode: id_norma,
              number: numero,
              query: consulta,
              signal,
            }),
          ),
          formato,
        );
      } catch (error) {
        return softBcnFailure(error, "Error al obtener norma");
      }
    },
  );

  server.registerTool(
    "estado_norma",
    {
      title: "Estado / metadata de publicación de una norma",
      description:
        "Metadatos BCN de publicación + enlaces a historia LeyChile (no determina vigencia jurídica por sí solo). Confirma siempre en la fuente oficial.",
      inputSchema: {
        id_norma: z.string().min(1),
        formato: formatoSchema,
      },
    },
    async ({ id_norma, formato }) => {
      try {
        const data = await timedSearch("estado_norma", (signal) =>
          estadoNorma(id_norma, { signal }),
        );
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
                "_Metadata BCN; confirma vigencia en LeyChile._",
                "",
                ...(Array.isArray(data.warnings)
                  ? data.warnings.map((w: string) => `- _${w}_`)
                  : []),
              ].join("\n"),
        );
      } catch (error) {
        return softBcnFailure(error, "Error estado_norma");
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
          await timedSearch("normas_relacionadas", (signal) =>
            normasRelacionadas(id_norma, { signal }),
          ),
          formato,
        );
      } catch (error) {
        return softBcnFailure(error, "Error normas_relacionadas");
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
        const norma = await timedSearch("obtener_texto_norma", (signal) =>
          parseNormaTexto(id_norma, {
            signal,
            timeoutMs: 18_000,
            retries: 2,
          }),
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
        const norma = await timedSearch("obtener_articulo", (signal) =>
          parseNormaTexto(id_norma, {
            signal,
            timeoutMs: 18_000,
            retries: 2,
          }),
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
        const norma = await timedSearch("obtener_inciso", (signal) =>
          parseNormaTexto(id_norma, {
            signal,
            timeoutMs: 18_000,
            retries: 2,
          }),
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
        "Genera cadena de cita formal SOLO con identificadores ya recuperados (norma, ROL, dictamen o doctrina). No inventa ni verifica datos: marca la cita como no verificada por el MCP.",
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
          `**Cita (no verificada por el MCP):** ${cited.citation}`,
          cited.url ? `**URL:** ${cited.url}` : undefined,
          "- Integridad: `candidate` — formateo local de inputs del cliente; no implica recuperación de fuente.",
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
        const quote = await timedSearch("citar_texto_legal", (signal) =>
          citarTextoLegal({ id_norma, articulo, inciso, letra, signal }),
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
    "mapa_norma",
    {
      title: "Mapear norma y artículos",
      description:
        "Recupera XML LeyChile y devuelve índice de artículos, materias y señales de derogación.",
      inputSchema: {
        id_norma: z.string().min(1),
        formato: formatoSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id_norma, formato }) => {
      try {
        const result = await timedSearch("mapa_norma", (signal) =>
          mapaNorma(id_norma, { signal }),
        );
        return okText(
          formato === "json" ? formatResultsJson(result) : result.markdown,
        );
      } catch (error) {
        return legalExtractionFailure(error, id_norma);
      }
    },
  );

  server.registerTool(
    "comparar_version_norma",
    {
      title: "Comparar versiones de norma",
      description:
        "Compara dos versiones XML LeyChile identificadas por fecha/idVersion; si el histórico no está disponible, devuelve candidate con la historia oficial.",
      inputSchema: {
        id_norma: z.string().min(1),
        fecha_a: z.string().min(1),
        fecha_b: z.string().min(1),
        articulo: z.string().optional(),
        formato: formatoSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id_norma, fecha_a, fecha_b, articulo, formato }) => {
      try {
        const result = await timedSearch("comparar_version_norma", (signal) =>
          compararVersionNorma({
            id_norma,
            fecha_a,
            fecha_b,
            articulo,
            signal,
          }),
        );
        return okText(
          formato === "json" ? formatResultsJson(result) : result.markdown,
        );
      } catch (error) {
        return legalExtractionFailure(error, id_norma);
      }
    },
  );

  server.registerTool(
    "buscar_reglamentos",
    {
      title: "Buscar reglamentos y decretos",
      description:
        "Busca reglamentos, decretos y resoluciones en BCN/LeyChile; devuelve metadata candidate y enlaces oficiales.",
      inputSchema: {
        consulta: z.string().min(2),
        tipo: z
          .enum([
            "decreto_supremo",
            "decreto",
            "resolucion",
            "reglamento",
            "auto_acordado",
          ])
          .optional(),
        limite: limitSchema,
        formato: formatoSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ consulta, tipo, limite, formato }) => {
      try {
        return okSearch(
          await timedSearch("buscar_reglamentos", (signal) =>
            searchReglamentos(consulta, limite, { signal, tipo }),
          ),
          formato,
        );
      } catch (error) {
        return softBcnFailure(error, "Error al buscar reglamentos");
      }
    },
  );

  server.registerTool(
    "buscar_tratados",
    {
      title: "Buscar tratados y convenios",
      description:
        "Busca tratados, convenios y pactos publicados o referenciados en BCN/LeyChile. Verifica siempre el texto promulgatorio.",
      inputSchema: {
        consulta: z.string().min(2),
        ambito: z.enum(["ddhh", "comercio", "otro"]).optional(),
        limite: limitSchema,
        formato: formatoSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ consulta, ambito, limite, formato }) => {
      try {
        return okSearch(
          await timedSearch("buscar_tratados", (signal) =>
            searchTratados(consulta, limite, { signal, ambito }),
          ),
          formato,
        );
      } catch (error) {
        return softBcnFailure(error, "Error al buscar tratados");
      }
    },
  );

  server.registerTool(
    "investigar_norma_relacionada",
    {
      title: "Investigar normas y doctrina relacionadas",
      description:
        "Cruza relaciones estructuradas BCN, texto de un artículo opcional y doctrina candidata por keywords.",
      inputSchema: {
        id_norma: z.string().min(1),
        articulo: z.string().optional(),
        limite: limitSchema,
        incluir_latam: z.boolean().default(false),
        pais_latam: z.enum(["PE", "BR", "AR", "MX", "CO"]).optional(),
        formato: formatoSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({
      id_norma,
      articulo,
      limite,
      incluir_latam,
      pais_latam,
      formato,
    }) => {
      try {
        const result = await timedSearch(
          "investigar_norma_relacionada",
          (signal) =>
            investigarNormaRelacionada(id_norma, {
              articulo,
              limite,
              incluirLatam: incluir_latam,
              paisLatam: pais_latam,
              signal,
            }),
        );
        return okText(
          formato === "json" ? formatResultsJson(result.pack) : result.markdown,
        );
      } catch (error) {
        return softBcnFailure(error, "Error investigar_norma_relacionada");
      }
    },
  );

  server.registerTool(
    "verificar_cita",
    {
      title: "Verificar una cita jurídica",
      description:
        "Clasifica y verifica una cita libre (artículo, ROL, dictamen o norma) sin inventar texto ni identificadores.",
      inputSchema: {
        cita: z.string().min(3),
        formato: formatoSchema,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ cita, formato }) => {
      try {
        const result = await timedSearch("verificar_cita", (signal) =>
          verificarCita(cita, { signal }),
        );
        return okText(
          formato === "json" ? formatResultsJson(result) : result.markdown,
        );
      } catch (error) {
        return softBcnFailure(error, "Error verificar_cita");
      }
    },
  );
}
