import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HOT_NORMAS } from "../catalog.js";
import { ANTI_HALLUCINATION_RULES } from "../integrity.js";
import { metrics } from "../metrics.js";
import { guiaDiaTipico } from "../siguientePaso.js";
import { planFlujoEstudio } from "../workflow.js";

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
        "- Entregables: `plantilla_escrito`, `minuta_cliente`, `borrador_mensaje_cliente`, `anexo_citas`",
        "- Carpeta: `lista_antecedentes`",
        "- Si te trabas: `siguiente_paso`",
      ].join("\n"),
  },
  "legalchile://guia/dia-tipico": {
    title: "Guía: día típico en el estudio",
    description:
      "Encadenamiento mañana/tarde de tools MCP para consulta, escrito y seguimiento.",
    body: () => guiaDiaTipico(),
  },
};

const PROMPT_CATALOG = [
  ["consulta_juridica_chile", "Consulta con tools MCP + integrity obligatoria"],
  ["memo_asesoria", "Memo IRAC con citas de tools"],
  ["checklist_recurso_proteccion", "Checklist art. 19/20 CPR + jurisprudencia"],
  ["checklist_demanda_laboral", "Checklist CT + jurisprudencia laboral"],
  ["citar_articulo_ley", "Obtener y citar un artículo oficial"],
  ["citar_doctrina_y_norma", "Doctrina OA + blockquote LeyChile"],
  ["lista_prueba_normativa", "Checklist idNorma+artículo antes de redactar"],
] as const;

function jsonResource(uri: string, data: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function registerStudyResources(
  server: McpServer,
  version = "unknown",
): void {
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

  // Roadmap resources use the newer namespace while the legalchile:// guides
  // above remain registered for existing clients and workflow shortcuts.
  server.registerResource(
    "honestidad_roadmap",
    "mcp-legal://honestidad",
    {
      title: "Matriz de honestidad",
      description:
        "Niveles integrity (verified/candidate/portal_stub) y reglas anti-alucinación.",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonResource(uri.href, {
        version,
        integrityLevels: {
          verified: "texto/fuente oficial recuperada por el MCP",
          candidate: "metadato o enlace a verificar; no afirmar contenido",
          portal_stub: "solo portal de búsqueda; NO es un documento encontrado",
        },
        antiHallucination: [...ANTI_HALLUCINATION_RULES],
        toolGuidance: {
          preferir_texto: [
            "citar_texto_legal",
            "obtener_articulo",
            "obtener_fallo_tc",
            "citar_jurisprudencia",
            "importar_fallo",
          ],
          link_only: ["buscar_jurisprudencia (PJUD)", "buscar_dictamenes"],
        },
      }),
  );

  server.registerResource(
    "normas_frecuentes_roadmap",
    "mcp-legal://normas-frecuentes",
    {
      title: "Catálogo de normas frecuentes",
      description:
        "Aliases locales → idNorma y áreas (CT, CPR, Ley Karin, 19.880, etc.).",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonResource(uri.href, {
        version,
        count: HOT_NORMAS.length,
        normas: HOT_NORMAS.map((n) => ({
          idNorma: n.idNorma,
          label: n.label,
          aliases: n.aliases,
          areas: n.areas,
          url: `https://www.bcn.cl/leychile/navegar?idNorma=${n.idNorma}`,
        })),
      }),
  );

  server.registerResource(
    "slos_roadmap",
    "mcp-legal://slos",
    {
      title: "SLOs y métricas en vivo",
      description: "Objetivos de latencia y snapshot de métricas.",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonResource(uri.href, {
        ...metrics.snapshot(version),
        note: "Métricas en proceso; en Render free se reinician en cada cold start.",
      }),
  );

  server.registerResource(
    "prompts_irac_roadmap",
    "mcp-legal://prompts",
    {
      title: "Catálogo de prompts MCP",
      description: "Prompts registrados para IRAC, checklists y citas.",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonResource(uri.href, {
        version,
        prompts: PROMPT_CATALOG.map(([name, summary]) => ({ name, summary })),
        tip: "Invoca prompts por nombre vía el cliente MCP; no inventes citas fuera de las tools.",
      }),
  );

  server.registerResource(
    "flujo_estudio_roadmap",
    "mcp-legal://flujo-estudio",
    {
      title: "Flujo de estudio recomendado",
      description: "Orden de tools para investigar sin afirmar fuentes no verificadas.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: [
            "# Flujo de estudio — MCP Legal Chile",
            "",
            "1. `investigar_tema` (opcional `area`/`perfil`) o `verificar_cita` si ya tienes la cita.",
            "2. Normas: `resolver_norma_frecuente` / `mapa_norma` → `citar_texto_legal` / `obtener_articulo`.",
            "3. TC: `buscar_tc` / `obtener_fallo_tc` / `citar_jurisprudencia`.",
            "4. PJUD: `importar_fallo` (texto o URL HTML) → `citar_jurisprudencia`.",
            "5. Dictámenes: CGR `resolver_dictamen`; laborales DT `buscar_dictamenes_dt`.",
            "6. Reglamentos/tratados: `buscar_reglamentos` / `buscar_tratados`; cross-link `investigar_norma_relacionada`.",
            "7. SERNAC/CMF: `buscar_circulares_sernac` / `buscar_circulares_cmf`.",
            "8. Doctrina: `buscar_doctrina` / `buscar_doctrina_latam` (no vinculante).",
            "",
            "Regla: si `integrity` ≠ `verified`, no afirmes el contenido del documento.",
          ].join("\n"),
        },
      ],
    }),
  );
}
