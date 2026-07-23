export interface CaseIdentifiers {
  rol?: string;
  rit?: string;
  ruc?: string;
  dictamen?: string;
  anio?: string;
  tribunal?: string;
  /** Sentencia, Auto, Resolución, etc. */
  tipo?: string;
}

const ROL_RE =
  /\b(?:rol|rol\s*n[ºo°.]?)\s*[:.]?\s*([0-9]{1,6}\s*[-–./]\s*[0-9]{2,4})\b/i;
const TC_ROL_RE =
  /\b([0-9]{3,5})\s*[-–]\s*([0-9]{2,4})(?:\s*[-–]\s*(INA|INC|CPT|CAA|CDS))?\b/i;

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
  const competencia = parts[2]?.toUpperCase();
  const display =
    numero && anio
      ? `${numero}-${anio}${competencia ? `-${competencia}` : ""}`
      : m.replace(/[–]/g, "-");
  const shortYear = anio.slice(-2);
  const searchTerms = [
    display,
    numero && anio ? `${numero}-${anio}` : "",
    numero && shortYear ? `${numero}-${shortYear}` : "",
    numero && shortYear && competencia
      ? `${numero}-${shortYear}-${competencia}`
      : "",
    numero,
  ].filter((v, i, a) => Boolean(v) && a.indexOf(v) === i);
  return {
    raw,
    display,
    numero,
    anio,
    searchTerms,
    likelyTc:
      /\b(?:tc|tribunal constitucional|ina|inc|cpt|caa|cds)\b/i.test(raw) ||
      Boolean(competencia && /^(INA|INC|CPT|CAA|CDS)$/i.test(competencia)),
  };
}

/**
 * Exact-ish ROL match: same case number, and same year when both sides have one.
 * Avoids false positives like 966-2020 vs 9666-2020 from naive substring checks.
 */
export function rolMatches(
  hitRol: string,
  target: NormalizedRol | string,
): boolean {
  const norm = typeof target === "string" ? normalizeRol(target) : target;
  if (!norm.numero) return false;
  const hit = normalizeRol(hitRol);
  if (!hit.numero || hit.numero !== norm.numero) return false;
  if (hit.anio && norm.anio && hit.anio !== norm.anio) return false;
  return true;
}

/** Extrae mención explícita de ROL desde texto libre ("rol 1234-2020"). */
export function extractRolMention(text: string): string | undefined {
  const m = text.match(
    /\b(?:rol|rol\s*n[ºo°.]?)\s*[:.]?\s*([0-9]{1,6}\s*[-–./]\s*[0-9]{2,4}(?:\s*[-–]\s*[A-Z]{2,4})?)\b/i,
  );
  return m?.[1]?.replace(/\s+/g, "");
}
const RIT_RE = /\bRIT\s*[:.]?\s*([A-Z0-9\-–/]+)\b/i;
const RUC_RE = /\bRUC\s*[:.]?\s*([0-9]{1,12}\s*-\s*[0-9Kk])\b/i;
const DICTAMEN_RE =
  /\bdictamen(?:es)?\s*n[ºo°.]?\s*([0-9]{1,6}(?:\s*[-/]\s*[0-9]{2,4})?)/i;
const YEAR_RE = /\b(19|20)\d{2}\b/;

function detectTribunal(text: string): string | undefined {
  const t = text.toLowerCase();
  if (t.includes("tribunal constitucional") || /\btc\b/.test(t))
    return "Tribunal Constitucional";
  if (t.includes("corte Suprema".toLowerCase()) || /\bcs\b/.test(t))
    return "Corte Suprema";
  const ca = text.match(
    /corte\s+de\s+apelaciones(?:\s+de\s+([A-Za-zÁÉÍÓÚáéíóúñÑ\s]+?))?(?=\s|,|\.|$|rol)/i,
  );
  if (ca || t.includes("corte de apelaciones") || /\bca\b/.test(t)) {
    const city = ca?.[1]?.trim();
    if (city && city.length > 2 && city.length < 40) {
      return `Corte de Apelaciones de ${city.replace(/\s+/g, " ")}`;
    }
    return "Corte de Apelaciones";
  }
  if (t.includes("juzgado")) return "Juzgado";
  return undefined;
}

function detectTipoResolucion(text: string): string | undefined {
  const m = text.match(
    /\b(Sentencia|Auto\s+acordado|Auto|Resoluci[oó]n|Decreto)\b/i,
  );
  if (!m?.[1]) return undefined;
  const raw = m[1].replace(/\s+/g, " ");
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

export function parseCaseIdentifiers(
  title: string,
  snippet = "",
): CaseIdentifiers {
  const hay = `${title} ${snippet}`;
  const rol =
    hay.match(ROL_RE)?.[1]?.replace(/\s+/g, "") ??
    hay.match(TC_ROL_RE)?.[0]?.replace(/\s+/g, "");
  const rit = hay.match(RIT_RE)?.[1];
  const ruc = hay.match(RUC_RE)?.[1]?.replace(/\s+/g, "");
  const dictamen = hay.match(DICTAMEN_RE)?.[1]?.replace(/\s+/g, "");
  const anio =
    (rol ? normalizeRol(rol).anio : undefined) || hay.match(YEAR_RE)?.[0];
  return {
    rol: rol ? normalizeRol(rol).display : undefined,
    rit,
    ruc,
    dictamen,
    anio,
    tribunal: detectTribunal(hay),
    tipo: detectTipoResolucion(hay),
  };
}
