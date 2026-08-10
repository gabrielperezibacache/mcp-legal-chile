import { foldForMatch, containsWholeAlias } from "./textMatch.js";

/** Canonical idNorma shortcuts for frequent Chilean statutes. */
export type LegalArea =
  | "constitucional"
  | "civil"
  | "penal"
  | "laboral"
  | "procesal"
  | "administrativo"
  | "consumidor"
  | "ambiental"
  | "general";

export interface HotNorma {
  aliases: string[];
  idNorma: string;
  label: string;
  areas: LegalArea[];
}

export const HOT_NORMAS: HotNorma[] = [
  {
    aliases: [
      "constitucion",
      "cpr",
      "constitución política",
      "recurso de proteccion",
      "recurso de protección",
      "art 19",
      "articulo 19",
    ],
    idNorma: "242302",
    label: "Constitución Política de la República",
    areas: ["constitucional", "general"],
  },
  {
    aliases: [
      "codigo civil",
      "código civil",
      "cc",
      "extracontractual",
      "art 2314",
      "articulo 2314",
      "2314",
    ],
    idNorma: "172986",
    label: "Código Civil",
    areas: ["civil"],
  },
  {
    aliases: ["codigo penal", "código penal", "cp"],
    idNorma: "1984",
    label: "Código Penal",
    areas: ["penal"],
  },
  {
    aliases: [
      "codigo del trabajo",
      "código del trabajo",
      "ct",
      "codigo trabajo",
      "despido injustificado",
      "indemnizacion por despido",
      "indemnización por despido",
      "tutela laboral",
      "tutela de derechos fundamentales",
    ],
    idNorma: "207436",
    label: "Código del Trabajo",
    areas: ["laboral"],
  },
  {
    aliases: [
      "ley karin",
      "21643",
      "21.643",
      "acoso laboral",
      "acoso sexual laboral",
    ],
    idNorma: "1200096",
    label:
      "Ley N° 21.643 (Ley Karin) — prevención del acoso y violencia en el trabajo",
    areas: ["laboral", "administrativo"],
  },
  {
    aliases: [
      "19628",
      "19.628",
      "ley dicom",
      "proteccion de la vida privada",
    ],
    idNorma: "141599",
    label: "Ley N° 19.628 sobre Protección de la Vida Privada",
    areas: ["civil", "administrativo"],
  },
  {
    aliases: [
      "19496",
      "19.496",
      "proteccion al consumidor",
      "protección al consumidor",
      "ley del consumidor",
      "clausula abusiva",
      "cláusula abusiva",
      "garantia legal",
      "garantía legal",
      "lpc",
    ],
    idNorma: "61438",
    label: "Ley N° 19.496 sobre Protección de los Derechos de los Consumidores",
    areas: ["consumidor", "civil"],
  },
  {
    aliases: [
      "codigo de procedimiento civil",
      "código de procedimiento civil",
      "cpc",
    ],
    idNorma: "22740",
    label: "Código de Procedimiento Civil",
    areas: ["procesal", "civil"],
  },
  {
    aliases: ["codigo procesal penal", "código procesal penal", "cpp"],
    idNorma: "176595",
    label: "Código Procesal Penal",
    areas: ["procesal", "penal"],
  },
  {
    aliases: [
      "codigo organico de tribunales",
      "código orgánico de tribunales",
      "cot",
      "loc tribunales",
    ],
    idNorma: "25563",
    label: "Código Orgánico de Tribunales",
    areas: ["procesal", "constitucional"],
  },
  {
    aliases: [
      "codigo de comercio",
      "código de comercio",
      "cdc comercio",
      "comercio codigo",
      "ccom",
    ],
    idNorma: "1974",
    label: "Código de Comercio",
    areas: ["civil"],
  },
  {
    aliases: [
      "codigo tributario",
      "código tributario",
      "dl 830",
      "decreto ley 830",
    ],
    idNorma: "6374",
    label: "Código Tributario (D.L. N° 830)",
    areas: ["administrativo", "civil"],
  },
  {
    aliases: [
      "18575",
      "18.575",
      "loc bases generales",
      "bases generales de la administracion",
      "bases generales de la administración",
      "ley organica bases administracion",
      "ley orgánica bases administración",
    ],
    idNorma: "29967",
    label:
      "Ley N° 18.575 Orgánica Constitucional de Bases Generales de la Administración del Estado",
    areas: ["administrativo", "constitucional"],
  },
  {
    aliases: [
      "19880",
      "19.880",
      "ley de procedimientos administrativos",
      "procedimiento administrativo",
      "lbpa",
      "ley 19880",
      "procedimientos administrativos",
    ],
    idNorma: "210676",
    label: "Ley N° 19.880 sobre Bases de los Procedimientos Administrativos",
    areas: ["administrativo"],
  },
  {
    aliases: ["19947", "19.947", "ley de matrimonio civil", "matrimonio civil"],
    idNorma: "225128",
    label: "Ley N° 19.947 de Matrimonio Civil",
    areas: ["civil"],
  },
  {
    aliases: ["19968", "19.968", "tribunales de familia", "ley de familia"],
    idNorma: "229557",
    label: "Ley N° 19.968 que Crea los Tribunales de Familia",
    areas: ["civil", "procesal"],
  },
  {
    aliases: [
      "20600",
      "20.600",
      "tribunales ambientales",
      "ley ambiental tribunales",
      "ley tribunales ambientales",
    ],
    idNorma: "1041361",
    label: "Ley N° 20.600 que Crea los Tribunales Ambientales",
    areas: ["ambiental", "procesal"],
  },
  {
    aliases: [
      "18101",
      "18.101",
      "ley de arrendamiento",
      "arrendamiento de predios urbanos",
      "arriendo habitacional",
    ],
    idNorma: "29526",
    label: "Ley N° 18.101 sobre Arrendamiento de Predios Urbanos",
    areas: ["civil"],
  },
  {
    aliases: [
      "18575",
      "18.575",
      "lob",
      "ley organica bases administracion",
      "ley orgánica bases administración",
      "bases de la administracion del estado",
      "ley organica bases administracion del estado",
    ],
    idNorma: "191865",
    label:
      "DFL N° 1 (texto refundido) Ley N° 18.575 — Bases Generales de la Administración del Estado",
    areas: ["administrativo", "constitucional"],
  },
];

function aliasMatchesQuery(query: string, alias: string): boolean {
  if (!alias) return false;
  if (query === alias) return true;
  if (alias.length <= 3) return containsWholeAlias(query, alias);
  if (containsWholeAlias(query, alias)) return true;
  // Avoid resolving a vague one-word query to a longer alias.
  return query.length >= 4 && containsWholeAlias(alias, query);
}

export function resolveHotNorma(query: string): HotNorma | undefined {
  const q = foldForMatch(query);
  let best: HotNorma | undefined;
  let bestLength = 0;
  for (const norma of HOT_NORMAS) {
    for (const rawAlias of norma.aliases) {
      const alias = foldForMatch(rawAlias);
      if (aliasMatchesQuery(q, alias) && alias.length > bestLength) {
        best = norma;
        bestLength = alias.length;
      }
    }
  }
  return best;
}

export function listHotNormas(area?: LegalArea): HotNorma[] {
  if (!area || area === "general") return [...HOT_NORMAS];
  return HOT_NORMAS.filter((n) => n.areas.includes(area));
}

export function hotNormasForArea(area: LegalArea): HotNorma[] {
  return listHotNormas(area);
}

export const LEGAL_AREAS: LegalArea[] = [
  "constitucional",
  "civil",
  "penal",
  "laboral",
  "procesal",
  "administrativo",
  "consumidor",
  "ambiental",
  "general",
];

/** Infer a practice area from lawyer-style free text. */
export function inferLegalArea(query: string): LegalArea | undefined {
  const q = foldForMatch(query);
  const rules: Array<{ area: LegalArea; re: RegExp }> = [
    {
      area: "laboral",
      re: /\b(despido|laboral|trabajador|tutela|acoso laboral|ley karin|indemnizacion por anos|finiquito|direccion del trabajo|dt|ordenanza|jornada)\b/,
    },
    {
      area: "penal",
      re: /\b(penal|delito|imputad|prision|querella|formalizacion|hurto|estafa)\b/,
    },
    {
      area: "consumidor",
      re: /\b(consumidor|sernac|clausula abusiva|proveedor|garantia legal)\b/,
    },
    {
      area: "constitucional",
      re: /\b(constitucion(?!al\b)|proteccion|amparo|tribunal constitucional|tc|inaplicabilidad|art(?:iculo)?\.?\s*19|garantia|cpr)\b/,
    },
    {
      area: "ambiental",
      re: /\b(ambiental|contaminacion|impacto ambiental|sea|sma|tribunales? ambientales?|20600|20\.600)\b/,
    },
    {
      area: "administrativo",
      re: /\b(administrativ|contraloria|dictamen|funcionari|municipal|expropiacion|18575|18\.575|organica constitucional|bases(?:\s+\w+){0,3}\s+administracion|19880|19\.880|ley organica bases)\b/,
    },
    {
      area: "procesal",
      re: /\b(procesal|recurso de casacion|medida cautelar|competencia del tribunal|codigo organico de tribunales|codigo de procedimiento)\b/,
    },
    {
      area: "civil",
      re: /\b(civil|contrato|obligacion|prescripcion|propiedad|familia|divorcio|extracontractual|art(?:iculo)?\.?\s*2314|responsabilidad civil|comercio|sociedad anonima|compraventa)\b/,
    },
    {
      area: "general",
      re: /\b(cmf|fintech|mercado financiero|valores negociables|banco comision)\b/,
    },
  ];
  return rules.find(({ re }) => re.test(q))?.area;
}

export const HOT_IDS_FOR_WARMUP = HOT_NORMAS.map((n) => n.idNorma);
