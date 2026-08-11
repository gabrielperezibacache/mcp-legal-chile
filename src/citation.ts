export interface ChileanCitationInput {
  tipo?: string;
  numero?: string;
  articulo?: string;
  inciso?: string;
  letra?: string;
  rol?: string;
  tribunal?: string;
  /** E.g. "15º", "décimo quinto", "15" */
  considerando?: string;
  dictamen?: string;
  anio?: string;
  titulo?: string;
  url?: string;
  /** Doctrine fields */
  autores?: string;
  revista?: string;
  doi?: string;
  volumen?: string;
  pagina?: string;
}

export type CitationStyle = "chile" | "bluebook" | "iso";

const TRIBUNAL_ABBREV: Record<string, string> = {
  "tribunal constitucional": "TC",
  "corte suprema": "CS",
  "corte de apelaciones": "CA",
  "juzgado de letras del trabajo": "JLT",
  "tribunal de defensa de la libre competencia": "TDLC",
};

export function abbreviateTribunal(tribunal?: string): string | undefined {
  if (!tribunal?.trim()) return undefined;
  const fold = tribunal
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
  const ca = tribunal.match(
    /corte\s+de\s+apelaciones\s+(?:de\s+)?(.+)/i,
  );
  if (ca?.[1]?.trim()) return `CA ${ca[1].trim()}`;
  for (const [key, abbr] of Object.entries(TRIBUNAL_ABBREV)) {
    const keyFold = key.normalize("NFD").replace(/\p{M}/gu, "");
    if (fold === keyFold || fold === abbr.toLowerCase()) return abbr;
    if (key !== "corte de apelaciones" && fold.includes(keyFold)) {
      return abbr;
    }
  }
  return tribunal;
}

function consideringText(raw: string): string {
  const text = raw.trim();
  return /^\d+$/.test(text)
    ? `${text}º`
    : text.replace(/\bconsiderandos?\b/i, "").trim();
}

/** Format citations for Chilean legal writing from already-fetched identifiers. */
export function formatChileanCitation(input: ChileanCitationInput): {
  citation: string;
  url?: string;
  notes: string[];
  estilo: CitationStyle;
} {
  const notes: string[] = [
    "Cita generada solo con identificadores proporcionados; no inventa ROLs ni dictámenes.",
  ];

  if (input.dictamen) {
    const citation = `Dictamen N° ${input.dictamen}${input.anio ? `/${input.anio}` : ""}${
      input.titulo ? `, ${input.titulo}` : ""
    }`;
    return {
      citation,
      url:
        input.url ??
        "https://www.contraloria.cl/web/cgr/dictamenes-y-pronunciamientos-juridicos",
      notes,
      estilo: "chile",
    };
  }

  if (input.autores || input.doi || input.revista) {
    const authors = input.autores ?? "s/a";
    const year = input.anio ? `(${input.anio})` : "";
    const title = input.titulo ? `"${input.titulo}"` : undefined;
    const loc = [
      input.revista,
      input.volumen ? `vol. ${input.volumen}` : undefined,
      input.pagina ? `pp. ${input.pagina}` : undefined,
    ]
      .filter(Boolean)
      .join(", ");
    const doi = input.doi
      ? ` DOI: ${input.doi.replace(/^https?:\/\/doi\.org\//i, "")}`
      : "";
    const citation =
      `${authors} ${year} ${title ?? ""}${loc ? `, ${loc}` : ""}.${doi}`
        .replace(/\s+/g, " ")
        .trim();
    return {
      citation,
      url:
        input.url ??
        (input.doi
          ? `https://doi.org/${input.doi.replace(/^https?:\/\/doi\.org\//i, "")}`
          : undefined),
      notes: [
        ...notes,
        "Cita doctrinal (no vinculante). Contrastar con texto oficial de LeyChile.",
      ],
      estilo: "chile",
    };
  }

  if (input.rol) {
    const bits: string[] = [];
    if (input.tribunal) bits.push(input.tribunal);
    // For jurisprudence, `tipo` is the resolution kind (Sentencia, Auto, etc.).
    if (input.tipo) bits.push(input.tipo);
    bits.push(`rol ${input.rol}`);
    if (input.considerando) {
      const raw = input.considerando.trim();
      const cons = /^\d+$/.test(raw)
        ? `${raw}º`
        : raw.replace(/\bconsiderandos?\b/i, "").trim();
      bits.push(`considerando ${cons}`);
    }
    const citation = `${bits.join(", ")}${input.anio ? ` (${input.anio})` : ""}`;
    return {
      citation,
      url: input.url,
      notes: [
        ...notes,
        input.considerando
          ? "Cita jurisprudencial con considerando: verifica el texto oficial (PDF/ficha)."
          : "Cita jurisprudencial: sin considerando, no afirmes ratio decidendi textual.",
      ],
      estilo: "chile",
    };
  }

  const parts: string[] = [];
  const tipoRaw = input.tipo?.trim() || "Norma";
  const titulo = input.titulo?.trim();
  const numeroRaw = input.numero?.trim();
  const numeroIsNumeric = Boolean(numeroRaw && /^\d/.test(numeroRaw));

  if (titulo && /c[oó]digo\s+(civil|penal|del\s+trabajo|de\s+comercio|procesal\s+penal|de\s+procedimiento\s+civil|org[aá]nico\s+de\s+tribunales|tributario|de\s+aguas)/i.test(titulo)) {
    parts.push(titulo.match(/c[oó]digo\s+[^\d,(]+/i)?.[0]?.trim() ?? titulo);
  } else if (numeroRaw && !numeroIsNumeric) {
    // tipo="Código" + numero="PENAL" → "Código Penal" (never "Código N° PENAL")
    const code = /c[oó]digo/i.test(tipoRaw)
      ? `Código ${numeroRaw}`
      : `${tipoRaw} ${numeroRaw}`;
    parts.push(code.replace(/\s+/g, " ").trim());
  } else if (numeroRaw && numeroIsNumeric) {
    const num = numeroRaw.includes(".")
      ? numeroRaw
      : numeroRaw.replace(/^(\d{1,2})(\d{3})$/, "$1.$2");
    if (titulo && /c[oó]digo\s+civil/i.test(titulo)) {
      parts.push(`Código Civil (${tipoRaw} N° ${num})`);
    } else {
      parts.push(`${tipoRaw} N° ${num}`);
    }
  } else if (titulo) {
    parts.push(titulo);
  } else {
    parts.push(tipoRaw);
  }

  if (input.articulo) {
    parts.push(`art. ${input.articulo}`);
  }
  if (input.inciso) {
    parts.push(`inc. ${input.inciso}`);
  }
  if (input.letra) {
    parts.push(`lit. ${input.letra})`);
  }

  return {
    citation: parts.join(", "),
    url: input.url,
    notes,
    estilo: "chile",
  };
}

/** Format with estilo chile | bluebook | iso. Never invents identifiers. */
export function formatCitation(
  input: ChileanCitationInput,
  estilo: CitationStyle = "chile",
): {
  citation: string;
  url?: string;
  notes: string[];
  estilo: CitationStyle;
} {
  if (estilo === "chile") return formatChileanCitation(input);

  const notes = [
    "Cita generada solo con identificadores proporcionados; no inventa ROLs ni dictámenes.",
    `Estilo ${estilo}: aproximación tipográfica; verifica el manual de estilo de tu foro.`,
  ];
  let citation: string;
  if (input.dictamen) {
    citation =
      estilo === "bluebook"
        ? `Contraloría General de la República [Chile], Dictamen No. ${input.dictamen}${input.anio ? ` (${input.anio})` : ""}`
        : `Contraloría General de la República (Chile). Dictamen N° ${input.dictamen}${input.anio ? `. ${input.anio}` : ""}.`;
  } else if (input.autores || input.doi || input.revista) {
    const authors = input.autores ?? "s/a";
    if (estilo === "bluebook") {
      citation = `${authors}${input.titulo ? `, "${input.titulo}"` : ""}${input.revista ? `, ${input.revista}` : ""}${input.volumen ? ` ${input.volumen}` : ""}${input.anio ? ` (${input.anio})` : ""}${input.pagina ? `, ${input.pagina}` : ""}${input.doi ? `, https://doi.org/${input.doi.replace(/^https?:\/\/doi\.org\//i, "")}` : ""}`.trim();
    } else {
      citation = `${authors}. (${input.anio ?? "s.f."}). ${input.titulo ?? "s/t"}${input.revista ? `. ${input.revista}` : ""}${input.volumen ? `, ${input.volumen}` : ""}${input.pagina ? `, ${input.pagina}` : ""}${input.doi ? `. Disponible en: https://doi.org/${input.doi.replace(/^https?:\/\/doi\.org\//i, "")}` : ""}.`;
    }
    notes.push(
      "Cita doctrinal (no vinculante). Contrastar con texto oficial de LeyChile.",
    );
  } else if (input.rol) {
    if (estilo === "bluebook") {
      const court = abbreviateTribunal(input.tribunal) ?? input.tribunal ?? "Chile";
      citation = `${court} [Chile], ${input.tipo ?? "Sentencia"} Rol ${input.rol}${input.considerando ? `, c. ${consideringText(input.considerando).replace(/º$/, "")}` : ""}${input.anio ? ` (${input.anio})` : ""}`;
    } else {
      citation = `${input.tribunal ?? "Tribunal"} (Chile). (${input.anio ?? "s.f."}). ${input.tipo ?? "Sentencia"} rol ${input.rol}${input.considerando ? `. Considerando ${consideringText(input.considerando)}` : ""}.`;
    }
  } else {
    const tipoRaw = input.tipo?.trim() || "Ley";
    const numeroRaw = input.numero?.trim();
    const titulo = input.titulo?.trim();
    const numeroIsNumeric = Boolean(numeroRaw && /^\d/.test(numeroRaw));
    const isCodigo =
      /c[oó]digo/i.test(tipoRaw) ||
      (titulo && /c[oó]digo/i.test(titulo));
    let normaCore: string;
    if (isCodigo && numeroRaw && !numeroIsNumeric) {
      normaCore = `Código ${numeroRaw}`;
    } else if (titulo && /c[oó]digo/i.test(titulo) && !numeroIsNumeric) {
      normaCore = titulo.match(/c[oó]digo\s+[^\d,(]+/i)?.[0]?.trim() ?? titulo;
    } else if (estilo === "bluebook") {
      normaCore = `${tipoRaw}${numeroRaw ? ` No. ${numeroRaw}` : titulo ? ` "${titulo}"` : ""}`;
    } else {
      normaCore = `${tipoRaw}${numeroRaw ? ` N° ${numeroRaw}` : titulo && !numeroRaw ? `. ${titulo}` : ""}`;
    }
    if (estilo === "bluebook") {
      citation = `${normaCore}${input.articulo ? `, art. ${input.articulo}` : ""}${input.inciso ? `, inc. ${input.inciso}` : ""}${input.letra ? `, lit. ${input.letra})` : ""} [Chile]`;
    } else {
      citation = `${normaCore}${input.anio ? ` (${input.anio})` : ""}${input.articulo ? `. Artículo ${input.articulo}` : ""}${input.inciso ? `, inciso ${input.inciso}` : ""}${input.letra ? `, literal ${input.letra})` : ""} [Chile].`;
    }
  }

  return { citation, url: input.url, notes, estilo };
}
