/**
 * Structural templates for Chilean legal deliverables.
 * Skeletons only — content must come from MCP tools / user facts.
 */

export const ESCRITO_TIPOS = [
  "demanda_laboral",
  "recurso_proteccion",
  "juicio_ejecutivo",
  "contencioso_administrativo",
  "recurso_nulidad_penal",
  "escrito_familia",
  "generico",
] as const;

export type EscritoTipo = (typeof ESCRITO_TIPOS)[number];

export const MINUTA_TIPOS = [
  "actualizacion_causa",
  "resumen_asesoria",
  "solicitud_antecedentes",
] as const;

export type MinutaTipo = (typeof MINUTA_TIPOS)[number];

const FILL_RULES = [
  "Rellena solo con hechos aportados por el usuario y textos `verified` de tools.",
  "Marca `[POR VERIFICAR]` donde la fuente sea link_only / candidate / portal_stub.",
  "No inventes ROL, montos, plazos ni considerandos.",
  "Incluye URL bajo cada cita normativa o jurisprudencial.",
  "Cierra con disclaimer: no es asesoría jurídica formal.",
];

function header(tipo: string, materia?: string, hechos?: string): string[] {
  return [
    `# Plantilla de escrito — \`${tipo}\``,
    "",
    materia ? `**Materia:** ${materia}` : undefined,
    hechos ? `**Hechos aportados:** ${hechos}` : undefined,
    "",
    "## Reglas de relleno",
    ...FILL_RULES.map((r) => `- ${r}`),
    "",
    "## Tools sugeridas antes de redactar",
  ].filter((x): x is string => Boolean(x));
}

export function plantillaEscrito(opts: {
  tipo: EscritoTipo;
  materia?: string;
  hechos?: string;
}): string {
  const { tipo, materia, hechos } = opts;
  const lines = header(tipo, materia, hechos);

  switch (tipo) {
    case "demanda_laboral":
      lines.push(
        "1. `investigar_tema` / `obtener_articulo` Código del Trabajo (idNorma 207436)",
        "2. `buscar_jurisprudencia` → PJUD con `pegar_fallo_pjud` si hay texto",
        "",
        "## Estructura",
        "### I. Tribunal competente y partes",
        "- Demandante / Demandado / RUT (solo si aportados)",
        "### II. Hechos",
        "- Cronología (fechas solo si constan en el input)",
        "### III. Derecho",
        "- Normas CT con blockquote `verified`",
        "- Jurisprudencia citables vs `[POR VERIFICAR]`",
        "### IV. Pretensiones",
        "- Listar sin inventar montos (indemnizaciones, cotizaciones, etc.)",
        "### V. Petitorio",
        "### VI. Prueba ofrecida",
        "### VII. Qué falta verificar",
      );
      break;
    case "recurso_proteccion":
      lines.push(
        "1. `obtener_articulo` CPR art. 20 (idNorma 242302) y garantías art. 19",
        "2. `buscar_tc` / `pegar_fallo_pjud` según corresponda",
        "",
        "## Estructura",
        "### I. Competencia y legitimación",
        "### II. Hechos y acto u omisión impugnado",
        "### III. Derechos garantizados afectados (art. 19 CPR)",
        "### IV. Requisitos del art. 20 CPR (blockquote oficial)",
        "### V. Jurisprudencia (solo verified / texto pegado)",
        "### VI. Petitorio (orden de no innovar / restablecimiento)",
        "### VII. Prueba y plazos",
        "### VIII. Qué falta verificar",
      );
      break;
    case "juicio_ejecutivo":
      lines.push(
        "1. `obtener_articulo` CPC (idNorma 22740) — título ejecutivo y procedimiento",
        "2. Jurisprudencia solo con texto verificado",
        "",
        "## Estructura",
        "### I. Tribunal y partes",
        "### II. Título ejecutivo invocado (describir documento aportado; no inventar cláusulas)",
        "### III. Derecho (CPC + normas del título)",
        "### IV. Liquidación / monto (solo si aportado)",
        "### V. Petitorio (despacho de ejecución, embargos)",
        "### VI. Excepciones previsibles del ejecutado `[POR VERIFICAR]`",
        "### VII. Qué falta verificar",
      );
      break;
    case "contencioso_administrativo":
      lines.push(
        "1. Ley 19.880 (210676) y Ley 18.575 (29967) vía `obtener_articulo`",
        "2. `resolver_dictamen` / `citar_dictamen_pegado`",
        "",
        "## Estructura",
        "### I. Acto administrativo impugnado",
        "### II. Hechos y procedimiento previo",
        "### III. Derecho (plazos, invalidación, recursos — texto oficial)",
        "### IV. Dictámenes CGR (texto pegado o `[POR VERIFICAR]`)",
        "### V. Vicios alegados",
        "### VI. Petitorio",
        "### VII. Qué falta verificar",
      );
      break;
    case "recurso_nulidad_penal":
      lines.push(
        "1. CPP (176595) causales/plazos; CP (1984) si tipicidad/pena",
        "2. `pegar_fallo_pjud` para CS/CA",
        "",
        "## Estructura",
        "### I. Sentencia impugnada (tribunal, ROL, fecha — solo si aportados)",
        "### II. Hechos procesales relevantes",
        "### III. Causal(es) de nulidad (artículos CPP con blockquote)",
        "### IV. Desarrollo: error de derecho vs hechos",
        "### V. Jurisprudencia citables",
        "### VI. Petitorio",
        "### VII. Qué falta verificar",
      );
      break;
    case "escrito_familia":
      lines.push(
        "1. Ley 19.968 (229557) + Código Civil (172986); matrimonio → 19.947 (225128)",
        "2. Jurisprudencia con texto verificado",
        "",
        "## Estructura",
        "### I. Tribunal de Familia y partes",
        "### II. Hechos",
        "### III. Derecho aplicable (blockquote oficial)",
        "### IV. Pretensiones (alimentos / cuidado / relación directa — sin montos inventados)",
        "### V. Medidas cautelares solicitadas (si corresponden)",
        "### VI. Petitorio y prueba",
        "### VII. Qué falta verificar",
      );
      break;
    default:
      lines.push(
        "1. `investigar_tema` → `citar_texto_legal` / `pegar_fallo_pjud` / `citar_dictamen_pegado`",
        "",
        "## Estructura",
        "### I. Partes y competencia",
        "### II. Hechos",
        "### III. Derecho (normas verified)",
        "### IV. Jurisprudencia / dictámenes",
        "### V. Petitorio",
        "### VI. Qué falta verificar",
      );
  }

  lines.push(
    "",
    "## Salida esperada",
    "- Borrador estructurado con headings anteriores.",
    "- Tras cada norma/fallo: cita + URL + integrity.",
  );
  return lines.join("\n");
}

export function minutaCliente(opts: {
  tipo: MinutaTipo;
  contexto: string;
  rol_o_rit?: string;
  caratulado?: string;
  destinatario?: string;
  tono?: "formal" | "claro";
}): string {
  const tono = opts.tono ?? "claro";
  const lines: string[] = [
    `# Minuta al cliente — \`${opts.tipo}\``,
    "",
    opts.destinatario ? `**Para:** ${opts.destinatario}` : undefined,
    opts.caratulado ? `**Caratulado:** ${opts.caratulado}` : undefined,
    opts.rol_o_rit ? `**ROL/RIT:** \`${opts.rol_o_rit}\`` : undefined,
    `**Tono:** ${tono}`,
    "",
    "## Instrucciones para el asistente",
    "- Redacta usando **solo** el contexto de abajo. No agregues hechos judiciales ni resoluciones no mencionadas.",
    "- Si el contexto viene de PJUD/OJV, marca integrity=`candidate` y pide contrastar en el portal.",
    "- Incluye un párrafo de próximos pasos y qué se necesita del cliente.",
    "- Disclaimer breve al final.",
    "",
    "## Contexto aportado (fuente)",
    "```",
    opts.contexto.trim(),
    "```",
    "",
  ].filter((x): x is string => Boolean(x));

  switch (opts.tipo) {
    case "actualizacion_causa":
      lines.push(
        "## Estructura del mensaje",
        "1. Saludo breve",
        "2. Identificación de la causa (solo datos del contexto)",
        "3. Qué cambió / últimos movimientos",
        "4. Qué implica en lenguaje no técnico",
        "5. Próximos pasos y plazos **solo si constan**",
        "6. Pedido de antecedentes (si falta algo)",
        "7. Disclaimer + invitación a llamar/reunión",
      );
      break;
    case "solicitud_antecedentes":
      lines.push(
        "## Estructura del mensaje",
        "1. Saludo y propósito",
        "2. Lista numerada de documentos/datos faltantes (derivados del contexto)",
        "3. Por qué se necesitan (sin inventar estrategia confidencial innecesaria)",
        "4. Plazo sugerido de envío (solo si el usuario lo indicó)",
        "5. Disclaimer",
      );
      break;
    default:
      lines.push(
        "## Estructura del mensaje",
        "1. Saludo",
        "2. Resumen de la consulta en 2–4 frases",
        "3. Hallazgos verificados vs pendientes de verificación",
        "4. Riesgos / alternativas en lenguaje claro",
        "5. Próximos pasos recomendados",
        "6. Disclaimer",
      );
  }

  return lines.join("\n");
}
