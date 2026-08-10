/**
 * Suggest the next MCP tool given where the lawyer/assistant is in the flow.
 */

export const ESTADOS_FLUJO = [
  "inicio",
  "pack_listo",
  "prueba_normativa_lista",
  "texto_legal_listo",
  "fallo_pegado",
  "dictamen_pegado",
  "causa_obtenida",
  "actuaciones_comparadas",
  "escrito_estructurado",
  "anexo_armado",
  "mensaje_cliente_listo",
] as const;

export type EstadoFlujo = (typeof ESTADOS_FLUJO)[number];

/** Infer a sensible flow state from free-text (agents often omit `estado`). */
export function inferEstadoFlujo(consulta?: string): EstadoFlujo {
  const q = (consulta ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (!q.trim()) return "inicio";
  if (
    /\b(mensaje al cliente|borrador listo|ya envie|ya envié)\b/.test(q)
  ) {
    return "mensaje_cliente_listo";
  }
  if (/\b(anexo de citas|anexo armado|anexo listo)\b/.test(q)) {
    return "anexo_armado";
  }
  if (
    /\b(escrito estructurado|plantilla lista|demanda armada|recurso armado)\b/.test(
      q,
    )
  ) {
    return "escrito_estructurado";
  }
  if (/\b(actuaciones comparadas|diff de movimientos)\b/.test(q)) {
    return "actuaciones_comparadas";
  }
  if (
    /\b(causa obtenida|ya tengo la causa|ojv|rit\b|obtener_causa)\b/.test(q)
  ) {
    return "causa_obtenida";
  }
  if (/\b(dictamen pegado|dictamen cgr pegado)\b/.test(q)) {
    return "dictamen_pegado";
  }
  if (
    /\b(fallo pegado|considerando|importar_fallo|pegar_fallo)\b/.test(q)
  ) {
    return "fallo_pegado";
  }
  if (
    /\b(ya tengo el art|texto legal|articulo listo|cita legal lista|obtener_articulo)\b/.test(
      q,
    )
  ) {
    return "texto_legal_listo";
  }
  if (
    /\b(prueba normativa|lista_prueba|articulos a obtener)\b/.test(q)
  ) {
    return "prueba_normativa_lista";
  }
  if (
    /\b(pack listo|ya investig|investigar_tema|pack de investigacion)\b/.test(q)
  ) {
    return "pack_listo";
  }
  // Lawyer follow-up after citing CT art often asks "qué sigue para demanda"
  if (/\b(demanda|tutela|que sigue|qué sigue|escrito)\b/.test(q)) {
    return "texto_legal_listo";
  }
  return "inicio";
}

export function siguientePaso(opts: {
  estado?: EstadoFlujo;
  consulta?: string;
}): string {
  const inferred = !opts.estado;
  const estado = opts.estado ?? inferEstadoFlujo(opts.consulta);
  const q = opts.consulta?.trim();
  const lines = [
    `# Siguiente paso — estado \`${estado}\``,
    inferred
      ? `_Estado inferido desde la consulta (pasa \`estado\` explícito si quieres forzar el flujo)._`
      : undefined,
    q ? `**Consulta:** ${q}` : undefined,
    "",
  ].filter((x): x is string => Boolean(x));

  switch (estado) {
    case "inicio":
      lines.push(
        "1. `catalogo_flujos` (opcional) o `asesorar` / `preparar_entregable` con `modo=auto`.",
        "2. Norma conocida: `resolver_norma_frecuente` → `obtener_articulo`.",
        "3. Si es carpeta nueva: `lista_antecedentes` → `borrador_mensaje_cliente` (solicitud).",
      );
      break;
    case "pack_listo":
      lines.push(
        "1. `lista_prueba_normativa`.",
        "2. `obtener_articulo` / `citar_texto_legal` de 2–4 normas clave.",
        "3. Si hay links PJUD: pedir texto y `indice_considerandos` / `pegar_fallo_pjud`.",
      );
      break;
    case "prueba_normativa_lista":
      lines.push(
        "1. Ejecuta cada `obtener_articulo` sugerido.",
        "2. Guarda citas en `anexo_citas` (integrity verified).",
        "3. `plantilla_escrito` o continúa el relleno de `preparar_entregable`.",
      );
      break;
    case "texto_legal_listo":
      lines.push(
        "1. Jurisprudencia: `buscar_jurisprudencia` / `buscar_tc`.",
        "2. PJUD con texto → `pegar_fallo_pjud`; sin texto → deep link + pedir pegado.",
        "3. Redacta IRAC o escrito; marca `[POR VERIFICAR]` lo candidate.",
      );
      break;
    case "fallo_pegado":
      lines.push(
        "1. Si aún no: `indice_considerandos` para elegir el fragmento.",
        "2. `pegar_fallo_pjud` con `considerando` o `consulta`.",
        "3. Añade la cita a `anexo_citas` y vuelve al escrito.",
      );
      break;
    case "dictamen_pegado":
      lines.push(
        "1. `citar_dictamen_pegado`.",
        "2. Incorpora a `anexo_citas`.",
        "3. Continúa el contencioso-administrativo / memo.",
      );
      break;
    case "causa_obtenida":
      lines.push(
        "1. Si hay snapshot previo: `comparar_actuaciones`.",
        "2. `aviso_desde_causa` o `borrador_mensaje_cliente` (actualizacion_causa).",
        "3. Contrastar en OJV antes de enviar.",
      );
      break;
    case "actuaciones_comparadas":
      lines.push(
        "1. `borrador_mensaje_cliente` enfocando solo las **Nuevas**.",
        "2. Opcional: `lista_antecedentes` si falta documentación.",
      );
      break;
    case "escrito_estructurado":
      lines.push(
        "1. Completa blockquotes verified faltantes.",
        "2. `anexo_citas` final.",
        "3. Revisa sección «Qué falta verificar» antes de usar el borrador.",
      );
      break;
    case "anexo_armado":
      lines.push(
        "1. Relectura del escrito vs anexo (solo verified en el cuerpo).",
        "2. Si el cliente espera novedades: `borrador_mensaje_cliente` (resumen_asesoria).",
      );
      break;
    case "mensaje_cliente_listo":
      lines.push(
        "1. Revisa el borrador humano-a-humano (tono, plazos, datos sensibles).",
        "2. Verifica causas en OJV si integrity era candidate.",
        "3. Archiva el contexto; no inventes seguimiento posterior.",
      );
      break;
  }

  lines.push(
    "",
    "_Si el estado no encaja, vuelve a `catalogo_flujos` o `asesorar`._",
  );
  return lines.join("\n");
}

export function guiaDiaTipico(): string {
  return [
    "# Día típico en el estudio — MCP Legal Chile",
    "",
    "Guía corta de cómo encadenar tools en una jornada real.",
    "",
    "## Mañana — consulta nueva",
    "1. `asesorar` `modo=auto` con la pregunta del cliente.",
    "2. `lista_prueba_normativa` → `obtener_articulo` / `citar_texto_legal`.",
    "3. Memo IRAC o `preparar_entregable` si ya se ve un escrito.",
    "4. `lista_antecedentes` + `borrador_mensaje_cliente` (solicitud) si falta carpeta.",
    "",
    "## Mediodía — jurisprudencia / CGR",
    "1. Buscar → abrir portal → pegar texto.",
    "2. `indice_considerandos` → `pegar_fallo_pjud` o `citar_dictamen_pegado`.",
    "3. `anexo_citas` con lo verified.",
    "",
    "## Tarde — seguimiento de causas",
    "1. `obtener_causa_pjud` / datos pegados de OJV.",
    "2. `comparar_actuaciones` vs snapshot de ayer.",
    "3. `aviso_desde_causa` o `borrador_mensaje_cliente` (actualizacion_causa).",
    "",
    "## Cierre",
    "1. `siguiente_paso` con el estado actual si te trabas.",
    "2. Resource `legalchile://guia/honestidad` antes de firmar/enviar.",
    "",
    "Regla de oro: **no citar lo que no sea `verified` o texto pegado contrastable**.",
  ].join("\n");
}
