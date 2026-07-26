import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ANTI_HALLUCINATION_RULES } from "../integrity.js";
import { metrics } from "../metrics.js";
import { formatResultsJson } from "../util.js";
import { okText } from "./helpers.js";

export function registerMetaTools(server: McpServer, version: string): void {
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
          version,
          honestyMatrix: {
            buscar_legislacion: "candidate / metadata BCN + buscador LeyChile",
            obtener_norma: "candidate / metadata BCN",
            estado_norma:
              "candidate / metadata publicación BCN (no determina vigencia sola)",
            normas_relacionadas:
              "candidate / metadata BCN (predicados estructurados: modifica/modificada por/refunde/rectificada por/regulada por/concuerda con)",
            obtener_texto_norma: "verified / full_text (LeyChile XML)",
            obtener_articulo: "verified / full_text (LeyChile XML)",
            obtener_inciso: "verified / full_text heurístico",
            citar_texto_legal: "verified / full_text + cita formal",
            formatear_cita:
              "candidate — formateo local de inputs del cliente (no verifica fuente)",
            buscar_jurisprudencia:
              "candidate o portal_stub (nunca afirmar ratio desde links)",
            buscar_tc: "candidate / TC API metadata + PDF",
            resolver_rol: "candidate / portales + TC",
            obtener_fallo_tc:
              "verified extracto + índice considerandos; candidate (solo ficha/doctrina, evidence=metadata) si el ROL no está en el índice de texto TC",
            citar_jurisprudencia:
              "verified (full_text) si TC indexado o texto pegado; candidate (resumen ficha / evidence=metadata) si el ROL no está en el índice de texto TC; rechaza considerando inexistente",
            buscar_dictamenes: "candidate / link_only (verificar CGR)",
            resolver_dictamen: "candidate / link_only por número CGR",
            buscar_derecho_chileno:
              "pack mixto parcial OK (~8s); integrity por resultado",
            investigar_tema:
              "pack mixto parcial OK (~18s); integrity por sección; no inventa vacíos",
            buscar_doctrina: "candidate / metadata OA (no vinculante)",
            buscar_doctrina_latam: "candidate / metadata OA LATAM",
            obtener_doctrina: "candidate / ArticleMeta SciELO-DOI-OpenAlex",
            acerca_de: "metadata del servidor (esta tool)",
          },
          integrityLevels: {
            verified: "texto/fuente oficial recuperada por el MCP",
            candidate: "metadato o enlace a verificar; no afirmar contenido",
            portal_stub:
              "solo portal de búsqueda; NO es un documento encontrado",
          },
          slo: metrics.snapshot().slo,
          guidance: [...ANTI_HALLUCINATION_RULES],
        }),
      ),
  );
}
