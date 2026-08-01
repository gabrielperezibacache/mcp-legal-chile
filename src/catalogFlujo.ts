/**
 * Discoverable catalog of lawyer workflows + client-document checklists.
 */

import { ESCRITO_TIPOS, type EscritoTipo } from "./templates.js";
import { FLUJO_MODOS, type FlujoModo } from "./workflow.js";

export const ANTECEDENTE_MATERIAS = [
  "laboral",
  "proteccion",
  "ejecutivo",
  "familia",
  "penal",
  "administrativo",
  "civil_general",
  "consumidor",
] as const;

export type AntecedenteMateria = (typeof ANTECEDENTE_MATERIAS)[number];

export interface FlujoCatalogEntry {
  id: string;
  titulo: string;
  cuando: string;
  tools: string[];
  prompts?: string[];
  resource?: string;
}

export const FLUJO_CATALOG: FlujoCatalogEntry[] = [
  {
    id: "memo",
    titulo: "Memo IRAC",
    cuando: "Necesitas un análisis con fuentes antes de aconsejar o litigar.",
    tools: ["asesorar", "investigar_tema", "citar_texto_legal", "anexo_citas"],
    prompts: ["memo_asesoria", "flujo_estudio"],
    resource: "legalchile://guia/memo",
  },
  {
    id: "escrito",
    titulo: "Escrito / demanda / recurso",
    cuando: "Vas a redactar y necesitas estructura + normas verified.",
    tools: [
      "preparar_entregable",
      "plantilla_escrito",
      "asesorar",
      "pegar_fallo_pjud",
      "anexo_citas",
    ],
    prompts: ["plantilla_escrito", "checklist_*"],
    resource: "legalchile://guia/escrito",
  },
  {
    id: "seguimiento_causa",
    titulo: "Seguimiento de causa → cliente",
    cuando: "Hay movimientos PJUD y debes avisar al cliente.",
    tools: [
      "obtener_causa_pjud",
      "comparar_actuaciones",
      "aviso_desde_causa",
      "minuta_cliente",
    ],
    prompts: ["minuta_cliente"],
    resource: "legalchile://guia/seguimiento",
  },
  {
    id: "cita_pjud",
    titulo: "Citar fallo PJUD pegado",
    cuando: "Tienes el texto del fallo CS/CA/juzgado.",
    tools: ["indice_considerandos", "pegar_fallo_pjud", "citar_jurisprudencia"],
    prompts: ["pegar_fallo_pjud"],
  },
  {
    id: "cita_cgr",
    titulo: "Citar dictamen CGR pegado",
    cuando: "Tienes el texto del dictamen desde Contraloría.",
    tools: ["resolver_dictamen", "citar_dictamen_pegado"],
    prompts: ["pegar_dictamen_cgr"],
  },
  {
    id: "antecedentes",
    titulo: "Qué pedirle al cliente",
    cuando: "Abrir carpeta o preparar demanda sin inventar hechos.",
    tools: ["lista_antecedentes", "minuta_cliente"],
    prompts: ["minuta_cliente"],
  },
];

/** Tools that must remain registered for the study-workflow surface. */
export const REQUIRED_STUDY_TOOLS = [
  "flujo_estudio",
  "asesorar",
  "preparar_entregable",
  "plantilla_escrito",
  "minuta_cliente",
  "aviso_desde_causa",
  "anexo_citas",
  "comparar_actuaciones",
  "lista_antecedentes",
  "catalogo_flujos",
  "pegar_fallo_pjud",
  "indice_considerandos",
  "citar_dictamen_pegado",
  "investigar_tema",
] as const;

export function formatCatalogoFlujos(): string {
  const lines = [
    "# Catálogo de flujos — MCP Legal Chile",
    "",
    "Elige un flujo y llama las tools en orden. No inventes fuentes.",
    "",
  ];
  for (const f of FLUJO_CATALOG) {
    lines.push(`## ${f.titulo} (\`${f.id}\`)`);
    lines.push(`- **Cuándo:** ${f.cuando}`);
    lines.push(`- **Tools:** ${f.tools.map((t) => `\`${t}\``).join(", ")}`);
    if (f.prompts?.length) {
      lines.push(
        `- **Prompts:** ${f.prompts.map((p) => `\`${p}\``).join(", ")}`,
      );
    }
    if (f.resource) lines.push(`- **Resource:** \`${f.resource}\``);
    lines.push("");
  }
  lines.push(
    "## Modos de `asesorar` / `flujo_estudio`",
    ...FLUJO_MODOS.map((m) => `- \`${m}\``),
    "",
    "## Tipos de `plantilla_escrito`",
    ...ESCRITO_TIPOS.map((t) => `- \`${t}\``),
    "",
    "## Honestidad",
    "- Resource: `legalchile://guia/honestidad`",
    "- Tool: `acerca_de`",
  );
  return lines.join("\n");
}

const ANTECEDENTES: Record<
  AntecedenteMateria,
  { titulo: string; items: string[]; normasHint: string[] }
> = {
  laboral: {
    titulo: "Laboral",
    items: [
      "Contrato de trabajo y anexos / liquidaciones de sueldo",
      "Carta de aviso / finiquito / comunicación de despido",
      "Comprobantes de cotizaciones (previred / planillas)",
      "Correos, WhatsApp o actas relevantes al conflicto",
      "Certificado de antigüedad / liquidaciones de vacaciones",
      "Poder o mandato si actúa representante",
    ],
    normasHint: [
      "Código del Trabajo idNorma 207436",
      "`checklist_demanda_laboral`",
    ],
  },
  proteccion: {
    titulo: "Recurso de protección",
    items: [
      "Acto u omisión impugnado (resolución, correo, denuncia, omisión)",
      "Fecha de conocimiento del acto (para plazo)",
      "Prueba de afectación de garantía constitucional",
      "Identificación del recurrido y domicilio/notificaciones",
      "Documentos que acrediten legitimación activa",
    ],
    normasHint: [
      "CPR idNorma 242302 arts. 19–20",
      "`checklist_recurso_proteccion`",
    ],
  },
  ejecutivo: {
    titulo: "Juicio ejecutivo",
    items: [
      "Título ejecutivo original o copia autorizada (pagaré, cheque, sentencia, etc.)",
      "Cálculo/liquidación de deuda y pagos parciales",
      "Domicilio del deudor y bienes embargables conocidos",
      "Endosos / cesiones / protestos si aplican",
      "Poder para demandar",
    ],
    normasHint: ["CPC idNorma 22740", "`checklist_juicio_ejecutivo`"],
  },
  familia: {
    titulo: "Familia",
    items: [
      "Certificados de nacimiento / matrimonio / acuerdo de unión civil",
      "Liquidaciones o antecedentes de ingresos de ambas partes",
      "Régimen de cuidado / visitas actual (si existe)",
      "Gastos de hijos (colegio, salud) con respaldos",
      "Medidas de protección o denuncias previas (si hay)",
    ],
    normasHint: [
      "Ley 19.968 idNorma 229557",
      "Código Civil idNorma 172986",
      "`checklist_familia`",
    ],
  },
  penal: {
    titulo: "Penal / nulidad",
    items: [
      "Individualización de la causa (RUC/RIT/ROL) y tribunal",
      "Sentencia o resolución impugnada (texto completo)",
      "Actas de audiencia relevantes",
      "Medios de prueba ofrecidos/rechazados",
      "Poder y datos de contacto del imputado/víctima según rol",
    ],
    normasHint: ["CPP idNorma 176595", "`checklist_recurso_nulidad_penal`"],
  },
  administrativo: {
    titulo: "Contencioso-administrativo / CGR",
    items: [
      "Acto administrativo impugnado (texto íntegro y notificación)",
      "Expediente o piezas del procedimiento administrativo",
      "Recursos administrativos previos y sus resoluciones",
      "Dictámenes CGR citados (texto pegado si se usarán)",
      "Poder / personería para representar al recurrente",
    ],
    normasHint: [
      "Ley 19.880 idNorma 210676",
      "Ley 18.575 idNorma 29967",
      "`checklist_contencioso_administrativo`",
    ],
  },
  civil_general: {
    titulo: "Civil general",
    items: [
      "Contrato / título / escritura base de la pretensión",
      "Prueba de incumplimiento o daño (facturas, peritajes, fotos)",
      "Notificaciones / cartas de requerimiento previas",
      "Individualización de demandado y domicilio",
      "Poder para litigar",
    ],
    normasHint: ["Código Civil idNorma 172986", "CPC idNorma 22740"],
  },
  consumidor: {
    titulo: "Consumidor / LPC",
    items: [
      "Boleta / contrato / publicidad del proveedor",
      "Reclamos previos al Sernac o al proveedor y respuestas",
      "Prueba del producto/servicio defectuoso o incumplimiento",
      "Datos del proveedor (RUT, domicilio comercial)",
      "Cálculo de perjuicios solo con respaldos aportados",
    ],
    normasHint: ["Ley 19.496 idNorma 61438"],
  },
};

export function listaAntecedentes(opts: {
  materia: AntecedenteMateria;
  hechos?: string;
  urgencia?: string;
}): string {
  const pack = ANTECEDENTES[opts.materia];
  const lines = [
    `# Lista de antecedentes — ${pack.titulo}`,
    "",
    opts.hechos ? `**Contexto:** ${opts.hechos}` : undefined,
    opts.urgencia
      ? `**Urgencia / plazo indicado:** ${opts.urgencia}`
      : undefined,
    "",
    "## Pedir al cliente (no inventar que ya existen)",
    ...pack.items.map((item, i) => `${i + 1}. ${item}`),
    "",
    "## Herramientas útiles después",
    ...pack.normasHint.map((h) => `- ${h}`),
    "- `minuta_cliente` tipo `solicitud_antecedentes` para redactar el mensaje.",
    "- `asesorar` / `preparar_entregable` cuando lleguen los documentos.",
    "",
    "_Esta lista es orientativa de carpeta; no sustituye evaluación del caso._",
  ].filter((x): x is string => Boolean(x));
  return lines.join("\n");
}

export function mapEscritoToAntecedentes(
  tipo?: EscritoTipo,
): AntecedenteMateria {
  switch (tipo) {
    case "demanda_laboral":
      return "laboral";
    case "recurso_proteccion":
      return "proteccion";
    case "juicio_ejecutivo":
      return "ejecutivo";
    case "escrito_familia":
      return "familia";
    case "recurso_nulidad_penal":
      return "penal";
    case "contencioso_administrativo":
      return "administrativo";
    default:
      return "civil_general";
  }
}

export function inferModoFromConsulta(consulta: string): FlujoModo {
  const q = consulta.toLowerCase();
  if (/actuaci|movimiento|seguimiento|causa|ojv|rit\b|ruc\b/.test(q)) {
    return "seguimiento_causa";
  }
  if (/cita(r)?\b|considerando|dictamen|artículo|articulo/.test(q)) {
    return "cita_rapida";
  }
  if (/demanda|recurso|escrito|casaci|nulidad|protección|proteccion/.test(q)) {
    return "escrito";
  }
  if (/memo|irac|asesor/.test(q)) return "memo";
  return "consulta";
}
