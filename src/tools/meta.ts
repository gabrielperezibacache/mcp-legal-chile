import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FLUJO_CATALOG } from "../catalogFlujo.js";
import { ANTI_HALLUCINATION_RULES } from "../integrity.js";
import { metrics } from "../metrics.js";
import { formatResultsJson } from "../util.js";
import { okText } from "./helpers.js";

export function registerMetaTools(server: McpServer, version: string): void {
  server.registerTool(
    "acerca_de",
    {
      title: "Acerca de MCP Legal Chile",
      description:
        "Catálogo de flujos de estudio, matriz de honestidad y SLOs. Para el mapa narrativo usa también `catalogo_flujos`.",
      inputSchema: {},
    },
    async () =>
      okText(
        formatResultsJson({
          name: "MCP Legal Chile",
          version,
          workflows: FLUJO_CATALOG,
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
            pegar_fallo_pjud:
              "verified sobre texto aportado (PJUD/CS/CA); requiere texto pegado; rechaza considerando inexistente",
            indice_considerandos:
              "verified sobre texto aportado — índice/ranking de considerandos sin citar aún",
            buscar_dictamenes: "candidate / link_only (verificar CGR)",
            resolver_dictamen: "candidate / link_only por número CGR",
            citar_dictamen_pegado:
              "verified sobre texto aportado (CGR); requiere texto pegado del portal",
            buscar_administrativo:
              "portal_stub / link_only (CMF, Super Salud, SUSESO, SEC, SUPERIR)",
            buscar_derecho_chileno:
              "pack mixto parcial OK (~8s); integrity por resultado",
            investigar_tema:
              "pack mixto parcial OK (~18s); secciones Verificado/Por verificar/Portales + Próximos pasos; no inventa vacíos",
            flujo_estudio:
              "metadata local — plan de tools por modo (memo/escrito/seguimiento_causa/cita_rapida/consulta)",
            asesorar:
              "plan local + pack investigar_tema (modos memo/escrito/consulta); no inventa vacíos",
            plantilla_escrito:
              "metadata local — esqueleto de escrito; contenido debe venir de tools verified",
            minuta_cliente:
              "metadata local — estructura de mensaje al cliente a partir del contexto aportado",
            aviso_desde_causa:
              "metadata local — minuta de actualización desde campos/movimientos de causa (candidate)",
            anexo_citas:
              "metadata local — anexo verified vs por verificar; no inventa citas",
            comparar_actuaciones:
              "metadata local — diff de listas de movimientos (candidate)",
            catalogo_flujos: "metadata local — mapa de flujos y tools",
            lista_antecedentes:
              "metadata local — checklist de documentos a pedir al cliente",
            lista_prueba_normativa:
              "metadata local — idNorma/artículos sugeridos a obtener (no afirma texto)",
            preparar_entregable:
              "plan + plantilla + prueba normativa + antecedentes + pack (memo/escrito; modo auto)",
            borrador_mensaje_cliente:
              "metadata local — borrador de mensaje solo con contexto aportado",
            siguiente_paso:
              "metadata local — sugiere la siguiente tool según estado del flujo",
            buscar_doctrina: "candidate / metadata OA (no vinculante)",
            buscar_doctrina_latam: "candidate / metadata OA LATAM",
            obtener_doctrina: "candidate / ArticleMeta SciELO-DOI-OpenAlex",
            buscar_causa_pjud:
              "candidate (scraping OJV PJUD; experimental/no oficial)",
            obtener_causa_pjud:
              "candidate (scraping OJV PJUD; experimental/no oficial)",
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
