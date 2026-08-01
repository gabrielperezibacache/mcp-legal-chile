/**
 * Guided lawyer workflows — used by the `flujo_estudio` tool and prompts.
 * Pure guidance (no network): tells the assistant which MCP tools to call next.
 */

export const FLUJO_MODOS = [
  "memo",
  "escrito",
  "seguimiento_causa",
  "cita_rapida",
  "consulta",
] as const;

export type FlujoModo = (typeof FLUJO_MODOS)[number];

const COMMON_RULES = [
  "Usa solo tools de MCP Legal Chile. Prohibido inventar ROL, dictámenes, artículos o considerandos.",
  "Respeta integrity: `verified` se puede citar; `candidate`/`portal_stub`/`link_only` → no afirmes contenido.",
  "Siempre incluye URL. Aclara que no es asesoría jurídica formal.",
];

function deliverableSections(modo: FlujoModo): string[] {
  switch (modo) {
    case "memo":
      return [
        "Entregable: memo IRAC (Hechos / Issue / Rule con citas URL / Application / Conclusion).",
        "Cierra con sección **Qué falta verificar** si hubo link_only o portal_stub.",
      ];
    case "escrito":
      return [
        "Entregable: estructura de escrito (hechos, derecho con blockquotes verificados, petitorio).",
        "No inventes pretensiones ni montos. Separa **normas citables** vs **por verificar**.",
      ];
    case "seguimiento_causa":
      return [
        "Entregable: resumen de estado/movimientos + borrador de aviso al cliente.",
        "Todo dato PJUD es `candidate`. No afirmes resoluciones sin contraste en OJV.",
      ];
    case "cita_rapida":
      return [
        "Entregable: cita formal + blockquote + URL. Sin narrativa larga.",
      ];
    default:
      return [
        "Entregable: respuesta breve con fuentes, integrity y próximo paso concreto.",
      ];
  }
}

export function planFlujoEstudio(opts: {
  modo: FlujoModo;
  consulta: string;
  rol?: string;
  rit?: string;
  numero_dictamen?: string;
}): string {
  const { modo, consulta } = opts;
  const lines: string[] = [
    `# Flujo de estudio — modo \`${modo}\``,
    "",
    `**Consulta:** ${consulta}`,
    "",
    "## Reglas",
    ...COMMON_RULES.map((r) => `- ${r}`),
    "",
    "## Pasos (ejecutar en orden con tools)",
  ];

  switch (modo) {
    case "cita_rapida":
      lines.push(
        "1. Si es artículo de ley: `obtener_articulo` o `citar_texto_legal` (usa catálogo hot / `buscar_legislacion` si falta idNorma).",
        "2. Si es TC: `obtener_fallo_tc` / `citar_jurisprudencia` con ROL.",
        "3. Si es CS/CA/juzgado: abre el portal → pega texto en `pegar_fallo_pjud` (o `citar_jurisprudencia` con `texto`).",
        "4. Si es dictamen CGR: sin texto usa `resolver_dictamen`; con texto pegado usa `citar_dictamen_pegado`.",
      );
      break;
    case "seguimiento_causa":
      lines.push(
        opts.rol || opts.rit
          ? `1. \`obtener_causa_pjud\` con rol/rit \`${opts.rol ?? opts.rit}\` (si está habilitado; si no, portal_stub + link OJV).`
          : "1. `buscar_causa_pjud` con RUT/nombre o `obtener_causa_pjud` con ROL/RIT/RUC.",
        "2. Resume estado, litigantes y últimos movimientos indicando integrity=`candidate`.",
        "3. Si el caratulado sugiere materia normativa: `investigar_tema` acotado (opcional).",
        "4. Borrador de correo/WhatsApp al cliente con disclaimer y link al portal.",
      );
      break;
    case "escrito":
      lines.push(
        "1. `investigar_tema` para mapa de fuentes (parcial OK).",
        "2. Baja a texto oficial: `obtener_articulo` / `citar_texto_legal` de normas clave.",
        "3. Jurisprudencia: TC con `buscar_tc`/`obtener_fallo_tc`; PJUD con `pegar_fallo_pjud` tras pegar fallo.",
        opts.numero_dictamen
          ? `4. Dictamen ${opts.numero_dictamen}: \`citar_dictamen_pegado\` si hay texto; si no, \`resolver_dictamen\`.`
          : "4. Si hay contencioso-administrativo: `buscar_dictamenes` / `citar_dictamen_pegado`.",
        "5. Redacta estructura del escrito; lista pruebas y plazos sin inventar jurisprudencia.",
      );
      break;
    case "memo":
      lines.push(
        "1. `investigar_tema`.",
        "2. `obtener_articulo` / `citar_texto_legal` de 2–4 normas centrales.",
        "3. Si hay ROL TC en la consulta: `obtener_fallo_tc` / `citar_jurisprudencia`.",
        "4. Fallos PJUD solo con texto pegado (`pegar_fallo_pjud`).",
        "5. Redacta IRAC + **Qué falta verificar**.",
      );
      break;
    default:
      lines.push(
        "1. `investigar_tema` (mapa rápido).",
        "2. Extrae lo verificable con `citar_texto_legal` / `obtener_articulo` / `obtener_fallo_tc`.",
        "3. Para PJUD o CGR sin API de texto: indica deep link y pide pegar en `pegar_fallo_pjud` / `citar_dictamen_pegado`.",
        "4. Responde citando solo lo devuelto por tools.",
      );
  }

  lines.push(
    "",
    "## Formato de salida",
    ...deliverableSections(modo).map((s) => `- ${s}`),
  );
  lines.push(
    "",
    "## Prompts / tools útiles",
    "- `asesorar` (plan + pack), `plantilla_escrito`, `minuta_cliente`, `indice_considerandos`.",
    "- `memo_asesoria`, `lista_prueba_normativa`, `checklist_*`, `pegar_fallo_pjud`, `pegar_dictamen_cgr`.",
  );

  return lines.join("\n");
}

/** Modes where running investigar_tema as first step is usually useful. */
export function shouldRunPack(modo: FlujoModo): boolean {
  return modo === "memo" || modo === "escrito" || modo === "consulta";
}
