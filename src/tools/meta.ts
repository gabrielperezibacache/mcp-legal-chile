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
      description: "Catalogo, matriz de honestidad y SLOs.",
      inputSchema: {},
    },
    async () =>
      okText(
        formatResultsJson({
          name: "MCP Legal Chile",
          version,
          honestyMatrix: {
            obtener_articulo: "verified / full_text (LeyChile XML)",
            obtener_texto_norma: "verified / full_text (LeyChile XML)",
            obtener_inciso: "verified / full_text heuristico",
            citar_texto_legal: "verified / full_text + cita formal",
            citar_jurisprudencia:
              "verified (full_text) si TC indexado o texto pegado; metadata (resumen ficha) si el ROL no esta en el indice de texto TC; rechaza considerando inexistente",
            buscar_legislacion: "candidate / metadata BCN",
            normas_relacionadas:
              "candidate / metadata BCN (predicados estructurados: modifica/modificada por/refunde/rectificada por/regulada por/concuerda con)",
            buscar_jurisprudencia:
              "candidate o portal_stub (nunca afirmar ratio desde links)",
            buscar_tc: "candidate / TC API metadata + PDF",
            resolver_rol: "candidate / portales + TC",
            obtener_fallo_tc:
              "verified extracto + indice considerandos; metadata (solo ficha/doctrina) si el ROL no esta en el indice de texto TC",
            buscar_dictamenes: "candidate / link_only (verificar CGR)",
            buscar_doctrina: "candidate / metadata OA (no vinculante)",
            buscar_doctrina_latam: "candidate / metadata OA LATAM",
            obtener_doctrina: "candidate / ArticleMeta SciELO-DOI-OpenAlex",
          },
          integrityLevels: {
            verified: "texto/fuente oficial recuperada por el MCP",
            candidate: "metadato o enlace a verificar; no afirmar contenido",
            portal_stub:
              "solo portal de busqueda; NO es un documento encontrado",
          },
          slo: metrics.snapshot().slo,
          guidance: [...ANTI_HALLUCINATION_RULES],
        }),
      ),
  );
}
