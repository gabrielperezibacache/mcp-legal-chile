export interface CaseIdentifiers {
  rol?: string;
  rit?: string;
  ruc?: string;
  dictamen?: string;
  anio?: string;
  tribunal?: string;
}

const ROL_RE =
  /\b(?:rol|rol\s*n[ºo°.]?)\s*[:.]?\s*([0-9]{1,6}\s*[-–.\/]\s*[0-9]{2,4})\b/i;
const TC_ROL_RE = /\b([0-9]{3,5})\s*[-–]\s*([0-9]{2,4})(?:\s*[-–]\s*(INA|INC|CPT|CAA|CDS))?\b/i;

export interface NormalizedRol {
  raw: string;
  display: string;
  numero: string;
  anio: string;
  searchTerms: string[];
  likelyTc: boolean;
}

/** Normaliza ROL chileno (12345-2020, 12.345-20, etc.). */
export function normalizeRol(rol: string): NormalizedRol {
  const raw = rol.trim();
  const m =
    raw.match(ROL_RE)?.[1]?.replace(/\s+/g, "") ??
    raw.match(TC_ROL_RE)?.[0]?.replace(/\s+/g, "") ??
    raw.replace(/\s+/g, "");
  const parts = m.split(/[-–./]/).filter(Boolean);
  const numero = (parts[0] ?? m).replace(/\D/g, "");
  let anio = parts[1] ?? "";
  if (anio.length === 2) anio = `20${anio}`;
  const display =
    numero && anio ? `${numero}-${anio}` : m.replace(/[–]/g, "-");
  const shortYear = anio.slice(-2);
  const searchTerms = [
    display,
    `${numero}-${shortYear}`,
    numero,
  ].filter((v, i, a) => Boolean(v) && a.indexOf(v) === i);
  return {
    raw,
    display,
    numero,
    anio,
    searchTerms,
    likelyTc: /\b(?:tc|tribunal constitucional|ina|inc|cpt|caa|cds)\b/i.test(raw),
  };
}
const RIT_RE = /\bRIT\s*[:.]?\s*([A-Z0-9\-–\/]+)\b/i;
const RUC_RE = /\bRUC\s*[:.]?\s*([0-9]{1,12}\s*-\s*[0-9Kk])\b/i;
const DICTAMEN_RE =
  /\bdictamen(?:es)?\s*n[ºo°.]?\s*([0-9]{1,6}(?:\s*[-\/]\s*[0-9]{2,4})?)/i;
const YEAR_RE = /\b(19|20)\d{2}\b/;

function detectTribunal(text: string): string | undefined {
  const t = text.toLowerCase();
  if (t.includes("tribunal constitucional") || t.includes("tc "))
    return "Tribunal Constitucional";
  if (t.includes("corte Suprema".toLowerCase()) || /\bcs\b/.test(t))
    return "Corte Suprema";
  if (t.includes("corte de apelaciones") || /\bca\b/.test(t))
    return "Corte de Apelaciones";
  if (t.includes("juzgado")) return "Juzgado";
  return undefined;
}

export function parseCaseIdentifiers(
  title: string,
  snippet = "",
): CaseIdentifiers {
  const hay = `${title} ${snippet}`;
  const rol = hay.match(ROL_RE)?.[1]?.replace(/\s+/g, "");
  const rit = hay.match(RIT_RE)?.[1];
  const ruc = hay.match(RUC_RE)?.[1]?.replace(/\s+/g, "");
  const dictamen = hay.match(DICTAMEN_RE)?.[1]?.replace(/\s+/g, "");
  const anio = hay.match(YEAR_RE)?.[0];
  return {
    rol,
    rit,
    ruc,
    dictamen,
    anio,
    tribunal: detectTribunal(hay),
  };
}
