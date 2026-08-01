import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { planFlujoEstudio } from "../workflow.js";
import { ANTI_HALLUCINATION_RULES } from "../integrity.js";

const GUIDES: Record<
  string,
  { title: string; description: string; body: () => string }
> = {
  "legalchile://guia/memo": {
    title: "Guía: memo IRAC",
    description: "Plan de tools para memo de asesoría con fuentes verified.",
    body: () =>
      planFlujoEstudio({
        modo: "memo",
        consulta: "(reemplaza con tu consulta)",
      }),
  },
  "legalchile://guia/escrito": {
    title: "Guía: escrito",
    description: "Plan de tools + plantilla antes de redactar un escrito.",
    body: () =>
      [
        planFlujoEstudio({
          modo: "escrito",
          consulta: "(reemplaza con la materia del escrito)",
        }),
        "",
        "Luego: `plantilla_escrito` según tipo y `anexo_citas` con lo verified.",
      ].join("\n"),
  },
  "legalchile://guia/seguimiento": {
    title: "Guía: seguimiento de causa",
    description: "Causa PJUD → diff de actuaciones → minuta al cliente.",
    body: () =>
      [
        planFlujoEstudio({
          modo: "seguimiento_causa",
          consulta: "(RUT, nombre o ROL/RIT)",
        }),
        "",
        "Extras: `comparar_actuaciones` si tienes snapshot anterior; `minuta_cliente` / `aviso_desde_causa` para el mensaje.",
      ].join("\n"),
  },
  "legalchile://guia/honestidad": {
    title: "Matriz de honestidad",
    description: "Reglas anti-alucinación del conector.",
    body: () =>
      [
        "# Matriz de honestidad — MCP Legal Chile",
        "",
        "## Niveles",
        "- `verified`: texto/fuente oficial recuperada o texto pegado contrastable.",
        "- `candidate`: metadato o enlace; no afirmar contenido.",
        "- `portal_stub`: solo portal de búsqueda; NO es un documento encontrado.",
        "",
        "## Reglas",
        ...ANTI_HALLUCINATION_RULES.map((r) => `- ${r}`),
        "",
        "## Atajos de flujo",
        "- Mapa: `catalogo_flujos`",
        "- Memo/escrito: `preparar_entregable` / `asesorar`",
        "- PJUD texto: `indice_considerandos` → `pegar_fallo_pjud`",
        "- CGR texto: `citar_dictamen_pegado`",
        "- Entregables: `plantilla_escrito`, `minuta_cliente`, `anexo_citas`",
        "- Carpeta: `lista_antecedentes`",
      ].join("\n"),
  },
};

export function registerStudyResources(server: McpServer): void {
  for (const [uri, guide] of Object.entries(GUIDES)) {
    const name = uri.replace("legalchile://guia/", "guia_");
    server.registerResource(
      name,
      uri,
      {
        title: guide.title,
        description: guide.description,
        mimeType: "text/markdown",
      },
      async () => ({
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: guide.body(),
          },
        ],
      }),
    );
  }
}
