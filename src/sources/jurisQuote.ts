import { formatChileanCitation } from "../citation.js";
import { normalizeRol, rolMatches } from "../parsers.js";
import {
  findConsiderando,
  parseConsiderandos,
  pickSubstantiveConsiderando,
  rankConsiderandos,
  type Considerando,
} from "./considerandos.js";
import { excerptForQuote, getTcFicha, searchTcSentencias } from "./tcBuscador.js";

export interface JurisprudenciaQuote {
  citation: string;
  tribunal: string;
  tipoResolucion: string;
  rol: string;
  anio?: string;
  fecha?: string;
  competencia?: string;
  considerando?: string;
  considerandoNumero?: number;
  texto: string;
  blockquote: string;
  url: string;
  pdfUrl?: string;
  evidence: "full_text" | "metadata";
  sourceMode: "tc_api" | "texto_pegado";
  warnings: string[];
  considerandosDisponibles?: Array<{ numero?: number; label: string }>;
  markdown: string;
}

function yearFromFechaOrRol(fecha?: string, rolDisplay?: string): string | undefined {
  if (fecha && /^(19|20)\d{2}/.test(fecha)) return fecha.slice(0, 4);
  const m = rolDisplay?.match(/-(20\d{2}|19\d{2})\b/);
  return m?.[1];
}

function toBlockquote(texto: string): string {
  return texto
    .split(/(?<=\.)\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .map((line) => `> ${line}`)
    .join("\n");
}

async function loadTcSentence(
  rol: string,
  signal?: AbortSignal,
): Promise<{
  rolDisplay: string;
  content: string;
  competencia?: string;
  fichaUrl: string;
  pdfUrl?: string;
  fecha?: string;
  tipoResolucion: string;
  resultado?: string;
  /** True when `content` is only the TC's official doctrina/holding summary
   *  (ficha fallback), not the full sentence body from the search index. */
  isDoctrinaSummary?: boolean;
}> {
  const norm = normalizeRol(rol);
  let hit:
    | Awaited<ReturnType<typeof searchTcSentencias>>[number]
    | undefined;
  for (const term of norm.searchTerms) {
    const hits = await searchTcSentencias(term, 8, signal, { anio: norm.anio });
    hit =
      hits.find((h) => rolMatches(h.rol, norm)) ??
      hits.find((h) => h.rol === norm.numero);
    if (hit?.content) break;
  }

  if (hit?.content) {
    let ficha: Awaited<ReturnType<typeof getTcFicha>> | undefined;
    try {
      ficha = await getTcFicha(hit.rol, signal);
    } catch {
      try {
        ficha = await getTcFicha(hit.id, signal);
      } catch {
        /* optional */
      }
    }

    return {
      rolDisplay: norm.display,
      content: hit.content,
      competencia: hit.competencia ?? ficha?.competencia,
      fichaUrl: ficha?.fichaUrl ?? hit.fichaUrl,
      pdfUrl: ficha?.pdfUrl ?? hit.pdfUrl,
      fecha: ficha?.fecha,
      tipoResolucion: ficha?.tipoResolucion ?? "Sentencia",
      resultado: ficha?.resultado,
    };
  }

  // Fallback: the TC free-text search index does not cover every ROL (some
  // older/less-queried sentences are absent from `/api/extended/sentencias`),
  // but the metadata ficha endpoint (`/api/buscadorexterno/ficha/{folio}`) is
  // keyed directly by folio/ROL number and often still has it, including the
  // official "doctrina" (case-holding summary) written by the TC itself. Use
  // that as quotable content instead of failing outright — it is still an
  // official TC-authored text, just not full body text.
  try {
    const ficha = await getTcFicha(norm.numero, signal);
    if (ficha.doctrina && ficha.doctrina.length >= 80) {
      return {
        rolDisplay: norm.display,
        content: ficha.doctrina,
        competencia: ficha.competencia,
        fichaUrl: ficha.fichaUrl,
        pdfUrl: ficha.pdfUrl,
        fecha: ficha.fecha,
        tipoResolucion: ficha.tipoResolucion ?? "Sentencia",
        resultado: ficha.resultado,
        isDoctrinaSummary: true,
      };
    }
  } catch {
    /* fall through to the error below */
  }

  throw new Error(
    `No hay texto íntegro TC para rol ${norm.display}. Para fallos PJUD u otros tribunales, pasa el parámetro texto (pega el fallo oficial).`,
  );
}

function pickFragment(
  items: Considerando[],
  opts: { considerando?: string; consulta?: string },
): {
  picked?: Considerando;
  warnings: string[];
  ranked: Considerando[];
  considerandoNotFound?: string;
} {
  const warnings: string[] = [];
  if (!items.length) {
    return {
      warnings: [
        "No se detectaron considerandos enumerados en el texto; se cita un extracto del cuerpo (sin atribuir número de considerando).",
      ],
      ranked: [],
    };
  }

  // Never substitute another considering when an explicit number/label was requested.
  if (opts.considerando) {
    const found = findConsiderando(items, opts.considerando);
    if (found) return { picked: found, warnings, ranked: items };
    return {
      warnings: [
        `NO VERIFICADO: no existe el considerando «${opts.considerando}» en el texto aportado/recuperado.`,
        "No se sustituye por otro considerando (evitar citas falsas).",
      ],
      ranked: items,
      considerandoNotFound: opts.considerando,
    };
  }

  if (opts.consulta) {
    const ranked = rankConsiderandos(items, opts.consulta);
    if (ranked[0]) return { picked: ranked[0], warnings, ranked };
    warnings.push(
      "La consulta no coincidió con considerandos; se usa el más sustantivo detectado (verificar).",
    );
  }

  const substantive = pickSubstantiveConsiderando(items);
  if (substantive && substantive !== items[0]) {
    warnings.push(
      "Sin consulta temática: se cita el considerando más sustantivo (no el primero, a menudo procesal).",
    );
  } else if (!opts.consulta && !opts.considerando) {
    warnings.push(
      "Sin consulta ni número de considerando: se cita el fragmento más sustantivo disponible.",
    );
  }
  return {
    picked: substantive ?? items[0],
    warnings,
    ranked: items,
  };
}

function buildQuoteMarkdown(opts: {
  citation: string;
  tribunal: string;
  tipoResolucion: string;
  rolDisplay: string;
  anio?: string;
  fecha?: string;
  considerandoLabel?: string;
  considerandoNumero?: number;
  competencia?: string;
  resultado?: string;
  evidenceLabel: string;
  integrityLevel?: "verified" | "metadata";
  url?: string;
  pdfUrl?: string;
  blockquote: string;
  warnings: string[];
  disponibles: Array<{ numero?: number; label: string }>;
}): string {
  const cons =
    opts.considerandoLabel ||
    (opts.considerandoNumero != null ? `${opts.considerandoNumero}º` : undefined);

  return [
    `### Jurisprudencia citada`,
    "",
    "**Cita lista para pegar:**",
    "",
    `> ${opts.citation}`,
    "",
    `- **Tribunal:** ${opts.tribunal}`,
    `- **Tipo:** ${opts.tipoResolucion}`,
    `- **ROL:** \`${opts.rolDisplay}\``,
    opts.anio ? `- **Año:** ${opts.anio}` : undefined,
    opts.fecha ? `- **Fecha:** ${opts.fecha}` : undefined,
    cons
      ? `- **Considerando:** ${opts.considerandoLabel ?? cons}${opts.considerandoNumero != null && opts.considerandoLabel ? ` (${opts.considerandoNumero}º)` : ""}`
      : `- **Considerando:** _(no atribuido; extracto de cuerpo)_`,
    opts.competencia ? `- **Competencia:** ${opts.competencia}` : undefined,
    opts.resultado ? `- **Resultado:** ${opts.resultado}` : undefined,
    `- **Integridad:** \`${opts.integrityLevel ?? "verified"}\` — ${opts.evidenceLabel}`,
    opts.url ? `- **URL:** ${opts.url}` : undefined,
    opts.pdfUrl ? `- **PDF:** ${opts.pdfUrl}` : undefined,
    "",
    "**Fragmento textual:**",
    "",
    opts.blockquote,
    "",
    `_En el escrito: «${opts.citation}»._`,
    opts.warnings.length
      ? ["", "### Advertencias", ...opts.warnings.map((w) => `- ${w}`)].join("\n")
      : undefined,
    opts.disponibles.length
      ? [
          "",
          "### Otros considerandos detectados",
          ...opts.disponibles.map(
            (c) =>
              `- ${c.numero != null ? `${c.numero}º` : "?"} — ${c.label}`,
          ),
          "",
          "→ Vuelve a llamar con `considerando` (ej. `15` o `décimo quinto`) o `consulta` temática.",
        ].join("\n")
      : undefined,
  ]
    .filter((x): x is string => Boolean(x))
    .join("\n");
}

function quoteFromContent(opts: {
  content: string;
  tribunal: string;
  tipoResolucion: string;
  rolDisplay: string;
  anio?: string;
  fecha?: string;
  competencia?: string;
  resultado?: string;
  url?: string;
  pdfUrl?: string;
  considerando?: string;
  consulta?: string;
  maxChars: number;
  evidenceLabel: string;
  /** "metadata" when content is a summary (e.g. TC ficha doctrina), not full body text. */
  evidence?: "full_text" | "metadata";
  sourceMode: "tc_api" | "texto_pegado";
  extraWarnings?: string[];
}): JurisprudenciaQuote {
  const items = parseConsiderandos(opts.content);
  const { picked, warnings, ranked, considerandoNotFound } = pickFragment(
    items,
    {
      considerando: opts.considerando,
      consulta: opts.consulta,
    },
  );

  if (considerandoNotFound) {
    const disponibles = items
      .slice(0, 40)
      .map((c) => (c.numero != null ? `${c.numero}º (${c.label})` : c.label))
      .join("; ");
    throw new Error(
      [
        `NO VERIFICADO: no existe el considerando «${considerandoNotFound}» en el texto.`,
        "No se entrega un fragmento atribuido a ese considerando (evitar información falsa).",
        disponibles
          ? `Considerandos detectados: ${disponibles}.`
          : "No hay considerandos numerados detectados.",
        "Vuelve a llamar con un considerando de la lista, o sin el parámetro `considerando`.",
      ].join(" "),
    );
  }

  const allWarnings = [...(opts.extraWarnings ?? []), ...warnings];

  let texto: string;
  let considerandoLabel: string | undefined;
  let considerandoNumero: number | undefined;

  if (picked) {
    texto = excerptForQuote(picked.texto, opts.maxChars);
    considerandoLabel = picked.citationLabel;
    considerandoNumero = picked.numero;
  } else {
    // Body excerpt only — never invent a considerando number/label.
    const hay = opts.content;
    const idx = opts.consulta
      ? hay.toLowerCase().indexOf(opts.consulta.toLowerCase().slice(0, 40))
      : hay.search(/\bCONSIDERANDO\b/i);
    const start = idx >= 0 ? idx : 0;
    texto = excerptForQuote(
      hay.slice(start, start + opts.maxChars * 2),
      opts.maxChars,
    );
    allWarnings.push(
      "Extracto de cuerpo sin número de considerando verificado; no atribuir a un considerando concreto.",
    );
  }

  const consForCite = considerandoNumero
    ? `${considerandoNumero}º`
    : considerandoLabel;

  const cited = formatChileanCitation({
    tribunal: opts.tribunal,
    tipo: opts.tipoResolucion,
    rol: opts.rolDisplay,
    considerando: consForCite,
    anio: opts.anio,
    url: opts.url,
  });

  const blockquote = toBlockquote(texto);
  const disponibles = (ranked.length ? ranked : items).slice(0, 40).map((c) => ({
    numero: c.numero,
    label: c.label,
  }));

  const markdown = buildQuoteMarkdown({
    citation: cited.citation,
    tribunal: opts.tribunal,
    tipoResolucion: opts.tipoResolucion,
    rolDisplay: opts.rolDisplay,
    anio: opts.anio,
    fecha: opts.fecha,
    considerandoLabel,
    considerandoNumero,
    competencia: opts.competencia,
    resultado: opts.resultado,
    evidenceLabel: opts.evidenceLabel,
    integrityLevel: opts.evidence === "metadata" ? "metadata" : "verified",
    url: opts.url,
    pdfUrl: opts.pdfUrl,
    blockquote,
    warnings: allWarnings,
    disponibles,
  });

  return {
    citation: cited.citation,
    tribunal: opts.tribunal,
    tipoResolucion: opts.tipoResolucion,
    rol: opts.rolDisplay,
    anio: opts.anio,
    fecha: opts.fecha,
    competencia: opts.competencia,
    considerando: considerandoLabel,
    considerandoNumero,
    texto,
    blockquote,
    url: opts.url ?? "",
    pdfUrl: opts.pdfUrl,
    evidence: opts.evidence ?? "full_text",
    sourceMode: opts.sourceMode,
    warnings: allWarnings,
    considerandosDisponibles: disponibles,
    markdown,
  };
}

/** Infer tribunal / tipo / año from the first lines of a pasted judgment. */
export function inferMetaFromPastedText(texto: string): {
  tribunal?: string;
  tipoResolucion?: string;
  anio?: string;
  fecha?: string;
} {
  const head = texto.slice(0, 1_800);
  let tribunal: string | undefined;
  if (/tribunal\s+constitucional/i.test(head)) {
    tribunal = "Tribunal Constitucional";
  } else if (/corte\s+suprema/i.test(head)) {
    tribunal = "Corte Suprema";
  } else {
    const ca = head.match(
      /corte\s+de\s+apelaciones(?:\s+de\s+([A-Za-zÁÉÍÓÚáéíóúñÑ\s]{2,40}?))?(?=\s|,|\.|$|rol|en\s)/i,
    );
    if (ca) {
      const city = ca[1]?.trim().replace(/\s+/g, " ");
      tribunal =
        city && !/^(chile|la|el)\b/i.test(city)
          ? `Corte de Apelaciones de ${city}`
          : "Corte de Apelaciones";
    } else if (/juzgado/i.test(head)) {
      tribunal = "Juzgado";
    }
  }
  const tipo = head.match(
    /\b(Sentencia|Auto\s+acordado|Auto|Resoluci[oó]n|Decreto)\b/i,
  )?.[1];
  const fechaMatch = head.match(
    /\b(?:a\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+((?:19|20)\d{2})\b/i,
  );
  const anio =
    fechaMatch?.[3] ||
    head.match(/\b((?:19|20)\d{2})\b/)?.[1] ||
    head.match(/Rol\s+[0-9]+-(\d{2,4})/i)?.[1];
  let anioNorm = anio;
  if (anioNorm && anioNorm.length === 2) anioNorm = `20${anioNorm}`;
  const fecha = fechaMatch
    ? `${fechaMatch[1]} de ${fechaMatch[2].toLowerCase()} de ${fechaMatch[3]}`
    : undefined;
  return {
    tribunal,
    tipoResolucion: tipo
      ? tipo
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(" ")
      : undefined,
    anio: anioNorm,
    fecha,
  };
}

/**
 * Cita un fragmento exacto con considerando, tipo, tribunal, año y ROL.
 * - Sin `texto`: API pública gratuita del Tribunal Constitucional.
 * - Con `texto`: parsea el fallo pegado (PJUD u otro) — vía gratuita sin API comercial.
 */
export async function citarJurisprudencia(opts: {
  rol: string;
  tribunal?: string;
  tipoResolucion?: string;
  anio?: string;
  url?: string;
  /** Full judgment text pasted by the user (PJUD / other courts). */
  texto?: string;
  considerando?: string;
  consulta?: string;
  maxChars?: number;
  signal?: AbortSignal;
}): Promise<JurisprudenciaQuote> {
  const maxChars = opts.maxChars ?? 2_500;
  const pasted = opts.texto?.trim();

  if (pasted) {
    if (pasted.length < 80) {
      throw new Error(
        "El texto pegado es demasiado corto. Pega el fallo o al menos la sección de considerandos.",
      );
    }
    const norm = normalizeRol(opts.rol);
    const inferred = inferMetaFromPastedText(pasted);
    const tribunal =
      opts.tribunal?.trim() || inferred.tribunal || "Tribunal (texto aportado)";
    const tipoResolucion =
      opts.tipoResolucion?.trim() || inferred.tipoResolucion || "Sentencia";
    const anio =
      opts.anio?.trim() ||
      inferred.anio ||
      yearFromFechaOrRol(undefined, norm.display);
    return quoteFromContent({
      content: pasted,
      tribunal,
      tipoResolucion,
      rolDisplay: norm.display,
      anio,
      fecha: inferred.fecha,
      url: opts.url?.trim() || undefined,
      considerando: opts.considerando,
      consulta: opts.consulta,
      maxChars,
      evidenceLabel:
        "texto íntegro aportado por el usuario (verificar contra PDF/portal oficial)",
      sourceMode: "texto_pegado",
      extraWarnings: [
        "PJUD no ofrece API abierta de texto. Esta cita usa el texto que pegaste; contrástalo con la fuente oficial.",
      ],
    });
  }

  const sentence = await loadTcSentence(opts.rol, opts.signal);
  const anio =
    opts.anio?.trim() ||
    yearFromFechaOrRol(sentence.fecha, sentence.rolDisplay);
  if (sentence.isDoctrinaSummary && opts.considerando) {
    throw new Error(
      `NO VERIFICADO: el fallo rol ${sentence.rolDisplay} no está indexado en el buscador de texto íntegro del TC; solo se recuperó el resumen oficial de doctrina (sin considerandos numerados). No se puede atribuir al considerando «${opts.considerando}». Llama sin ese parámetro para citar el resumen, o usa el PDF oficial (${sentence.pdfUrl ?? "ver ficha"}) para el texto completo.`,
    );
  }
  return quoteFromContent({
    content: sentence.content,
    tribunal: opts.tribunal?.trim() || "Tribunal Constitucional",
    tipoResolucion: opts.tipoResolucion?.trim() || sentence.tipoResolucion,
    rolDisplay: sentence.rolDisplay,
    anio,
    fecha: sentence.fecha,
    competencia: sentence.competencia,
    resultado: sentence.resultado,
    url: opts.url?.trim() || sentence.fichaUrl,
    pdfUrl: sentence.pdfUrl,
    considerando: sentence.isDoctrinaSummary ? undefined : opts.considerando,
    consulta: sentence.isDoctrinaSummary ? undefined : opts.consulta,
    maxChars,
    evidenceLabel: sentence.isDoctrinaSummary
      ? "resumen oficial de doctrina TC (ficha); el fallo no está en el índice de texto íntegro — verifica el PDF oficial para el cuerpo completo"
      : "texto íntegro (buscador oficial TC, gratuito)",
    evidence: sentence.isDoctrinaSummary ? "metadata" : "full_text",
    sourceMode: "tc_api",
    extraWarnings: sentence.isDoctrinaSummary
      ? [
          "Este fragmento es el resumen de doctrina oficial del TC, no el cuerpo íntegro de la sentencia (no indexada en el buscador de texto). Verifica el PDF oficial antes de citar considerandos específicos.",
        ]
      : undefined,
  });
}
