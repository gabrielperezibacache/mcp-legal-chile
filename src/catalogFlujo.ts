/**
 * Discoverable catalog of lawyer workflows + client-document checklists.
 */

import { HOT_NORMAS, resolveHotNorma } from "./catalog.js";
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
      "lista_prueba_normativa",
      "plantilla_escrito",
      "asesorar",
      "pegar_fallo_pjud",
      "anexo_citas",
    ],
    prompts: ["plantilla_escrito", "checklist_*", "checklist_tutela_laboral"],
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
      "borrador_mensaje_cliente",
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
    tools: ["lista_antecedentes", "borrador_mensaje_cliente", "minuta_cliente"],
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
  "lista_prueba_normativa",
  "catalogo_flujos",
  "siguiente_paso",
  "borrador_mensaje_cliente",
  "pegar_fallo_pjud",
  "indice_considerandos",
  "citar_dictamen_pegado",
  "investigar_tema",
] as const;

export const FLUJO_MODOS_CON_AUTO = [...FLUJO_MODOS, "auto"] as const;

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
    "## Honestidad / día típico",
    "- Resource: `legalchile://guia/honestidad`",
    "- Resource: `legalchile://guia/dia-tipico`",
    "- Tools: `acerca_de`, `siguiente_paso`",
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
    case "tutela_laboral":
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

export function resolveFlujoModo(
  modo: FlujoModo | "auto",
  consulta: string,
): { modo: FlujoModo; inferred: boolean } {
  if (modo !== "auto") return { modo, inferred: false };
  return { modo: inferModoFromConsulta(consulta), inferred: true };
}

export function inferTipoEscrito(consulta: string): EscritoTipo {
  const q = consulta.toLowerCase();
  if (/tutela\s+laboral|tutela\s+de\s+derechos?\s+fundamentales/.test(q)) {
    return "tutela_laboral";
  }
  if (/despido|finiquito|laboral|fuero|cotizaci/.test(q)) {
    return "demanda_laboral";
  }
  if (/protecci[oó]n|art\.?\s*20|garant[ií]a\s+constitucional/.test(q)) {
    return "recurso_proteccion";
  }
  if (/ejecutiv|pagar[eé]|cheque|mandato\s+ejecutivo/.test(q)) {
    return "juicio_ejecutivo";
  }
  if (/alimento|cuidado\s+personal|familia|divorcio|visitas/.test(q)) {
    return "escrito_familia";
  }
  if (/nulidad\s+penal|recurso\s+de\s+nulidad/.test(q)) {
    return "recurso_nulidad_penal";
  }
  if (/casaci[oó]n/.test(q)) return "recurso_casacion";
  if (/dictamen|contralor|19\.?880|acto\s+administrativo/.test(q)) {
    return "contencioso_administrativo";
  }
  return "generico";
}

function extractArticuloMentions(consulta: string): string[] {
  const out: string[] = [];
  const re =
    /art[ií]culos?\s*([0-9]+(?:\s*bis)?(?:\s*[,y]\s*[0-9]+(?:\s*bis)?)*)/gi;
  for (const m of consulta.matchAll(re)) {
    const chunk = m[1] ?? "";
    for (const part of chunk.split(/\s*[,y]\s*/i)) {
      const n = part.replace(/\s+/g, " ").trim();
      if (n && !out.includes(n)) out.push(n);
    }
  }
  const single = consulta.match(/art[ií]culo\s*([0-9]+(?:\s*bis)?)/i);
  if (single?.[1]) {
    const n = single[1].replace(/\s+/g, " ");
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** Suggested articles to fetch before drafting — not asserted legal content. */
const SUGGESTED_ARTICLES: Partial<
  Record<
    EscritoTipo | AntecedenteMateria,
    Array<{ articulo: string; nota: string }>
  >
> = {
  demanda_laboral: [
    { articulo: "160", nota: "Causales de despido (verificar aplicables)" },
    { articulo: "161", nota: "Necesidades de la empresa / desahucio" },
    { articulo: "162", nota: "Formalidades del despido" },
    { articulo: "163", nota: "Indemnización por años de servicio" },
    { articulo: "168", nota: "Recurso judicial / nulidad del despido" },
  ],
  tutela_laboral: [
    {
      articulo: "485",
      nota: "Tutela de derechos fundamentales (verificar vigencia/texto)",
    },
    { articulo: "486", nota: "Procedimiento de tutela (verificar)" },
    { articulo: "489", nota: "Indemnización / medidas (verificar)" },
  ],
  recurso_proteccion: [
    { articulo: "19", nota: "Garantías constitucionales involucradas" },
    { articulo: "20", nota: "Recurso de protección" },
  ],
  juicio_ejecutivo: [
    {
      articulo: "434",
      nota: "Títulos ejecutivos (verificar numeración vigente)",
    },
    { articulo: "459", nota: "Oposición / excepciones (verificar)" },
  ],
  contencioso_administrativo: [
    { articulo: "53", nota: "Invalidación (Ley 19.880 — verificar)" },
    { articulo: "59", nota: "Plazos de impugnación (verificar)" },
  ],
  laboral: [
    { articulo: "162", nota: "Formalidades del despido" },
    { articulo: "168", nota: "Impugnación del despido" },
  ],
  proteccion: [
    { articulo: "19", nota: "Garantías" },
    { articulo: "20", nota: "Protección" },
  ],
};

export function listaPruebaNormativa(opts: {
  tema: string;
  tipo_escrito?: EscritoTipo;
}): string {
  const tema = opts.tema.trim();
  const tipo = opts.tipo_escrito ?? inferTipoEscrito(tema);
  const hot = resolveHotNorma(tema);
  const mentioned = extractArticuloMentions(tema);

  // Pick hot norma: explicit resolve, else map from escrito tipo.
  let idNorma = hot?.idNorma;
  let label = hot?.label;
  if (!idNorma) {
    const fallback: Partial<Record<EscritoTipo, string>> = {
      demanda_laboral: "207436",
      tutela_laboral: "207436",
      recurso_proteccion: "242302",
      juicio_ejecutivo: "22740",
      escrito_familia: "229557",
      recurso_nulidad_penal: "176595",
      recurso_casacion: "22740",
      contencioso_administrativo: "210676",
    };
    idNorma = fallback[tipo];
    label = HOT_NORMAS.find((n) => n.idNorma === idNorma)?.label ?? label;
  }

  const suggested =
    SUGGESTED_ARTICLES[tipo] ??
    SUGGESTED_ARTICLES[mapEscritoToAntecedentes(tipo)] ??
    [];

  const articles = new Map<string, string>();
  for (const a of mentioned) articles.set(a, "Mencionado en la consulta");
  for (const s of suggested) {
    if (!articles.has(s.articulo)) articles.set(s.articulo, s.nota);
  }

  const lines: string[] = [
    "# Lista de prueba normativa",
    "",
    `**Tema:** ${tema}`,
    `**Tipo inferido de escrito:** \`${tipo}\`${opts.tipo_escrito ? "" : " _(auto)_"}`,
    idNorma
      ? `**Norma candidata:** ${label ?? "Norma"} — idNorma \`${idNorma}\``
      : "**Norma candidata:** _(usa `buscar_legislacion`)_",
    "",
    "## Artículos a obtener antes de redactar",
    "_No cites el contenido hasta llamar `obtener_articulo` / `citar_texto_legal`._",
    "",
  ];

  if (!articles.size) {
    lines.push(
      "- Sin artículos sugeridos. Corre `investigar_tema` y vuelve a listar.",
    );
  } else {
    let i = 1;
    for (const [art, nota] of articles) {
      const tool = idNorma
        ? `\`obtener_articulo\` id_norma=${idNorma} articulo=${art}`
        : `\`buscar_legislacion\` + \`obtener_articulo\` articulo=${art}`;
      lines.push(`${i}. **Art. ${art}** — ${nota}`);
      lines.push(`   - ${tool}`);
      i += 1;
    }
  }

  lines.push(
    "",
    "## Otras normas frecuentes a contrastar",
    ...HOT_NORMAS.slice(0, 8).map(
      (n) =>
        `- ${n.label} (\`idNorma ${n.idNorma}\`) — aliases: ${n.aliases.slice(0, 3).join(", ")}`,
    ),
    "",
    "## Siguiente paso",
    "- Obtén el texto verified de cada artículo listado.",
    "- Jurisprudencia: `buscar_jurisprudencia` / `pegar_fallo_pjud`.",
    "- Arma el cuerpo con `plantilla_escrito` / `preparar_entregable` + `anexo_citas`.",
  );

  return lines.join("\n");
}
