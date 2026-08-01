/**
 * Format a pasted CGR (or other administrative) dictamen for citation.
 * Integrity is always tied to user-supplied text — never invents body content.
 */

function toBlockquote(texto: string, maxSentences = 12): string {
  const cleaned = texto.replace(/\s+/g, " ").trim();
  if (!cleaned) return "> _(sin extracto)_";
  return cleaned
    .split(/(?<=\.)\s+/)
    .filter(Boolean)
    .slice(0, maxSentences)
    .map((line) => `> ${line}`)
    .join("\n");
}

function excerpt(texto: string, maxChars: number): string {
  const clean = texto.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}…`;
}

function normalizeDictamenNumero(numero: string): string {
  return numero.replace(/\s+/g, "").replace(/^n[ºo°.]\s*/i, "");
}

function inferDictamenMeta(texto: string): {
  fecha?: string;
  organo?: string;
} {
  const head = texto.slice(0, 2_000);
  const fechaMatch = head.match(
    /\b(?:a\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+((?:19|20)\d{2})\b/i,
  );
  const organo = /contralor[ií]a\s+general/i.test(head)
    ? "Contraloría General de la República"
    : undefined;
  return {
    fecha: fechaMatch
      ? `${fechaMatch[1]} de ${fechaMatch[2].toLowerCase()} de ${fechaMatch[3]}`
      : undefined,
    organo,
  };
}

export interface DictamenQuote {
  citation: string;
  numero: string;
  organo: string;
  fecha?: string;
  texto: string;
  blockquote: string;
  url?: string;
  evidence: "full_text";
  integrity: "verified";
  sourceMode: "texto_pegado";
  warnings: string[];
  markdown: string;
}

export function citarDictamenPegado(opts: {
  numero: string;
  texto: string;
  url?: string;
  organo?: string;
  maxChars?: number;
}): DictamenQuote {
  const numero = normalizeDictamenNumero(opts.numero);
  if (!numero || numero.length < 1) {
    throw new Error("Indica el número del dictamen (ej. 12.345/2020 o 12345).");
  }
  const pasted = opts.texto.trim();
  if (pasted.length < 60) {
    throw new Error(
      "El texto pegado es demasiado corto. Pega el dictamen (o al menos la parte resolutiva) desde el portal CGR.",
    );
  }

  const maxChars = opts.maxChars ?? 2_500;
  const inferred = inferDictamenMeta(pasted);
  const organo =
    opts.organo?.trim() ||
    inferred.organo ||
    "Contraloría General de la República";
  const texto = excerpt(pasted, maxChars);
  const blockquote = toBlockquote(texto);
  const citation = `Dictamen N° ${numero}${inferred.fecha ? `, ${organo}, ${inferred.fecha}` : `, ${organo}`}`;
  const defaultUrl =
    `https://www.contraloria.cl/web/cgr/dictamenes-y-pronunciamientos-juridicos` +
    `?p_p_id=buscadordictamenes_WAR_buscadordictamenesportlet&p_p_lifecycle=0` +
    `&_buscadordictamenes_WAR_buscadordictamenesportlet_numero=${encodeURIComponent(numero)}`;
  const url = opts.url?.trim() || defaultUrl;
  const warnings = [
    "CGR no ofrece API abierta de texto íntegro. Esta cita usa el texto que pegaste; contrástalo con el portal oficial antes de asesorar.",
    "Integridad `verified` se refiere al texto aportado en esta llamada, no a una descarga automática desde Contraloría.",
  ];

  const markdown = [
    "### Dictamen citado (texto aportado)",
    "",
    "**Cita lista para pegar:**",
    "",
    `> ${citation}`,
    "",
    `- **Número:** \`${numero}\``,
    `- **Órgano:** ${organo}`,
    inferred.fecha ? `- **Fecha detectada:** ${inferred.fecha}` : undefined,
    "- **Integridad:** `verified` — texto íntegro aportado por el usuario (verificar contra portal CGR)",
    `- **URL de contraste:** ${url}`,
    "",
    "**Fragmento textual:**",
    "",
    blockquote,
    "",
    `_En el escrito: «${citation}»._`,
    "",
    "### Advertencias",
    ...warnings.map((w) => `- ${w}`),
    "",
    "→ Si aún no tienes el texto: `resolver_dictamen` / `buscar_dictamenes` (solo enlace).",
  ]
    .filter((x): x is string => Boolean(x))
    .join("\n");

  return {
    citation,
    numero,
    organo,
    fecha: inferred.fecha,
    texto,
    blockquote,
    url,
    evidence: "full_text",
    integrity: "verified",
    sourceMode: "texto_pegado",
    warnings,
    markdown,
  };
}
