/** Parse and resolve Chilean court "considerandos" (roman/ordinal headings). */

const UNITS: Record<string, number> = {
  primero: 1,
  segundo: 2,
  tercero: 3,
  cuarto: 4,
  quinto: 5,
  sexto: 6,
  septimo: 7,
  séptimo: 7,
  octavo: 8,
  noveno: 9,
};

const TENS: Record<string, number> = {
  decimo: 10,
  décimo: 10,
  undecimo: 11,
  undécimo: 11,
  duodecimo: 12,
  duodécimo: 12,
  vigesimo: 20,
  vigésimo: 20,
  trigesimo: 30,
  trigésimo: 30,
  cuadragesimo: 40,
  cuadragésimo: 40,
  quincuagesimo: 50,
  quincuagésimo: 50,
  sexagesimo: 60,
  sexagésimo: 60,
  septuagesimo: 70,
  septuagésimo: 70,
  octogesimo: 80,
  octogésimo: 80,
  nonagesimo: 90,
  nonagésimo: 90,
  centesimo: 100,
  centésimo: 100,
};

const ORDINAL_TOKEN =
  "(?:PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO|S[ÉE]PTIMO|OCTAVO|NOVENO|D[ÉE]CIM[OA]|UND[ÉE]CIM[OA]|DUOD[ÉE]CIM[OA]|VIG[ÉE]SIM[OA]|TRIG[ÉE]SIM[OA]|CUADRAG[ÉE]SIM[OA]|QUINCUAG[ÉE]SIM[OA]|SEXAG[ÉE]SIM[OA]|SEPTUAG[ÉE]SIM[OA]|OCTOG[ÉE]SIM[OA]|NONAG[ÉE]SIM[OA]|CENT[ÉE]SIM[OA])";

const HEADER_RE = new RegExp(
  `(?:^|\\n)\\s*(?:` +
    // Word ordinals: DÉCIMO QUINTO:
    `((?:${ORDINAL_TOKEN}(?:\\s+${ORDINAL_TOKEN}){0,3}))\\s*:\\s*` +
    // Arabic: 15º.- / 15.- / 15° :
    `|(\\d{1,3})\\s*[°ºo]?\\s*[.\\-–—:)]\\s*` +
    // "Considerando décimo quinto:" / "Considerando 15:"
    `|Considerando\\s+((?:${ORDINAL_TOKEN}(?:\\s+${ORDINAL_TOKEN}){0,3})|\\d{1,3}\\s*[°ºo]?)\\s*:\\s*` +
    `)`,
  "gi",
);

export interface Considerando {
  /** Original heading, e.g. "DÉCIMO QUINTO" */
  label: string;
  /** 1-based index when parseable */
  numero?: number;
  /** Display form for citations, e.g. "décimo quinto" / "15º" */
  citationLabel: string;
  texto: string;
}

function foldOrdinal(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Convert "DÉCIMO QUINTO" / "vigesimo primero" → number. */
export function ordinalWordsToNumber(label: string): number | undefined {
  const tokens = foldOrdinal(label).split(" ").filter(Boolean);
  if (!tokens.length) return undefined;

  let total = 0;
  let used = false;
  for (const token of tokens) {
    if (token in TENS) {
      total += TENS[token]!;
      used = true;
      continue;
    }
    if (token in UNITS) {
      total += UNITS[token]!;
      used = true;
      continue;
    }
    return undefined;
  }
  return used && total > 0 ? total : undefined;
}

/** Convert 15 → "décimo quinto" (Chilean considering style). */
export function numberToOrdinalWords(n: number): string | undefined {
  if (!Number.isInteger(n) || n < 1 || n > 199) return undefined;
  const unitNames = [
    "",
    "primero",
    "segundo",
    "tercero",
    "cuarto",
    "quinto",
    "sexto",
    "séptimo",
    "octavo",
    "noveno",
  ];
  if (n < 10) return unitNames[n];
  if (n === 10) return "décimo";
  if (n === 11) return "undécimo";
  if (n === 12) return "duodécimo";
  if (n < 20) return `décimo ${unitNames[n - 10]}`;

  const tensNames: Record<number, string> = {
    20: "vigésimo",
    30: "trigésimo",
    40: "cuadragésimo",
    50: "quincuagésimo",
    60: "sexagésimo",
    70: "septuagésimo",
    80: "octogésimo",
    90: "nonagésimo",
    100: "centésimo",
  };
  if (n in tensNames) return tensNames[n];
  if (n < 100) {
    const tens = Math.floor(n / 10) * 10;
    const unit = n % 10;
    return `${tensNames[tens]} ${unitNames[unit]}`;
  }
  if (n === 100) return "centésimo";
  const rest = n - 100;
  if (rest < 10) return `centésimo ${unitNames[rest]}`;
  if (rest === 10) return "centésimo décimo";
  if (rest < 20) return `centésimo décimo ${unitNames[rest - 10]}`;
  const tens = Math.floor(rest / 10) * 10;
  const unit = rest % 10;
  return unit
    ? `centésimo ${tensNames[tens]} ${unitNames[unit]}`
    : `centésimo ${tensNames[tens]}`;
}

/** Parse "15", "15º", "c. 15", "considerando 15", "décimo quinto". */
export function parseConsiderandoRef(ref: string): {
  numero?: number;
  label?: string;
} {
  const raw = ref.trim();
  if (!raw) return {};
  const num = raw.match(
    /(?:^|[^\p{L}])(?:c(?:onsiderando)?\.?\s*)?(\d{1,3})\s*[°ºo.]?\b/iu,
  );
  if (num?.[1]) return { numero: Number(num[1]) };
  const words = raw
    .replace(/^(?:considerando|c\.)\s+/i, "")
    .replace(/[°º.]/g, "")
    .trim();
  const n = ordinalWordsToNumber(words);
  if (n) return { numero: n, label: words };
  return { label: words };
}

function extractConsiderandoSection(text: string): string {
  const yIdx = text.search(/\bY\s+CONSIDERANDO\s*:/i);
  const start = yIdx >= 0 ? yIdx : text.search(/\bCONSIDERANDO\s*:/i);
  if (start < 0) return text;
  const from = text.slice(start);
  const end = from.search(
    /\n\s*(?:SE\s+RESUELVE|Y\s+RESUELVE|RESUELVO|POR\s+ESTAS\s+CONSIDERACIONES|Y\s+TENIENDO\s+PRESENTE)/i,
  );
  return end > 0 ? from.slice(0, end) : from;
}

function cleanConsiderandoText(texto: string): string {
  return texto
    .replace(/Código de validación:[\s\S]*?VALIDACION\.TCCHILE\.CL\/?/gi, " ")
    .replace(/\bNOVECIENTOS[^\n]*\n?/gi, " ")
    .replace(/\b0{3,}\d{3,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseConsiderandos(text: string): Considerando[] {
  if (!text?.trim()) return [];
  const section = extractConsiderandoSection(text);
  const matches = [...section.matchAll(HEADER_RE)];
  if (!matches.length) return [];

  const out: Considerando[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const wordLabel = match[1]?.replace(/\s+/g, " ").trim();
    const arabicNum = match[2] ? Number(match[2]) : undefined;
    const consRef = match[3]?.replace(/\s+/g, " ").trim();
    let label: string;
    let numero: number | undefined;
    if (wordLabel) {
      label = wordLabel;
      numero = ordinalWordsToNumber(label);
    } else if (arabicNum != null && Number.isFinite(arabicNum)) {
      numero = arabicNum;
      label =
        numberToOrdinalWords(arabicNum)?.toUpperCase() ?? String(arabicNum);
    } else if (consRef) {
      const parsed = parseConsiderandoRef(consRef);
      numero = parsed.numero;
      label =
        (numero ? numberToOrdinalWords(numero)?.toUpperCase() : undefined) ??
        consRef;
    } else {
      continue;
    }
    const key = foldOrdinal(label);
    const start = match.index! + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : section.length;
    const texto = cleanConsiderandoText(section.slice(start, end));
    if (texto.length < 30) continue;
    const dedupeKey = numero ? `n:${numero}` : `l:${key}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const citationLabel =
      (numero ? numberToOrdinalWords(numero) : undefined) ?? label.toLowerCase();
    out.push({
      label,
      numero,
      citationLabel,
      texto,
    });
  }
  return out;
}

export function findConsiderando(
  items: Considerando[],
  ref: string,
): Considerando | undefined {
  const parsed = parseConsiderandoRef(ref);
  if (parsed.numero != null) {
    const byNum = items.find((c) => c.numero === parsed.numero);
    if (byNum) return byNum;
  }
  if (parsed.label) {
    const needle = foldOrdinal(parsed.label);
    return items.find(
      (c) =>
        foldOrdinal(c.label) === needle ||
        foldOrdinal(c.citationLabel) === needle,
    );
  }
  return undefined;
}

function queryTokens(query: string): string[] {
  const stop = new Set([
    "a",
    "al",
    "con",
    "de",
    "del",
    "el",
    "en",
    "la",
    "las",
    "lo",
    "los",
    "para",
    "por",
    "que",
    "se",
    "un",
    "una",
    "y",
    "o",
    "considerando",
  ]);
  return foldOrdinal(query)
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stop.has(t));
}

const PROCEDURAL_RE =
  /\b(?:notificaci[oó]n|comparecencia|traslado|certifico|prove[ií]do|rol[eé]se|agr[eé]guese|t[eé]ngase\s+presente|autos?\s+para\s+fallo)\b/i;

const LEGAL_SUBSTANCE_RE =
  /\b(?:derecho|art[ií]culo|constituci[oó]n|ley|principio|garant[ií]a|indemnizaci[oó]n|responsabilidad|contrato|nulidad|recurso|protecci[oó]n|datos|laboral|penal|civil)\b/i;

function scoreConsiderandoAgainstQuery(
  c: Considerando,
  tokens: string[],
  bigrams: string[],
): number {
  const hay = foldOrdinal(c.texto);
  let score = 0;
  for (const t of tokens) {
    if (hay.includes(t)) score += t.length > 5 ? 4 : 2;
  }
  for (const bg of bigrams) {
    if (hay.includes(bg)) score += 6;
  }
  // Prefer substantive length (cap so huge blocks don't dominate).
  score += Math.min(12, Math.floor(c.texto.length / 120));
  if (LEGAL_SUBSTANCE_RE.test(c.texto)) score += 4;
  if (PROCEDURAL_RE.test(c.texto) && c.texto.length < 220) score -= 6;
  if (c.numero != null && c.numero <= 2 && c.texto.length < 180) score -= 2;
  return score;
}

/** Rank considerandos by keyword/phrase overlap with a free-text query. */
export function rankConsiderandos(
  items: Considerando[],
  query: string,
): Considerando[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return items;
  const bigrams: string[] = [];
  for (let i = 0; i + 1 < tokens.length; i++) {
    bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return [...items]
    .map((c) => ({
      c,
      score: scoreConsiderandoAgainstQuery(c, tokens, bigrams),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
}

/**
 * When no thematic query is given, pick a substantive considerando
 * instead of the often-procedural first one.
 */
export function pickSubstantiveConsiderando(
  items: Considerando[],
): Considerando | undefined {
  if (!items.length) return undefined;
  const scored = items.map((c) => {
    let score = Math.min(20, Math.floor(c.texto.length / 80));
    if (LEGAL_SUBSTANCE_RE.test(c.texto)) score += 8;
    if (PROCEDURAL_RE.test(c.texto) && c.texto.length < 220) score -= 10;
    if (c.numero != null && c.numero <= 2) score -= 3;
    // Mild preference for middle/later considerandos (often ratio).
    if (c.numero != null && c.numero >= 5) score += 2;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.c ?? items[0];
}
