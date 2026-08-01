import { foldForMatch, containsWholeAlias } from "./textMatch.js";

/** Canonical idNorma shortcuts for frequent Chilean statutes. */
export const HOT_NORMAS: Array<{
  aliases: string[];
  idNorma: string;
  label: string;
}> = [
  {
    aliases: ["constitucion", "cpr", "constitución política"],
    idNorma: "242302",
    label: "Constitución Política de la República",
  },
  {
    aliases: ["codigo civil", "código civil", "cc"],
    idNorma: "172986",
    label: "Código Civil",
  },
  {
    aliases: ["codigo penal", "código penal", "cp"],
    idNorma: "1984",
    label: "Código Penal",
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
    ],
    idNorma: "207436",
    label: "Código del Trabajo",
  },
  {
    aliases: ["19628", "19.628", "ley dicom", "proteccion de la vida privada"],
    idNorma: "141599",
    label: "Ley N° 19.628 sobre Protección de la Vida Privada",
  },
  {
    aliases: ["19496", "19.496", "proteccion al consumidor", "lpc"],
    idNorma: "61438",
    label: "Ley N° 19.496 sobre Protección de los Derechos de los Consumidores",
  },
  {
    aliases: [
      "codigo de procedimiento civil",
      "código de procedimiento civil",
      "cpc",
    ],
    idNorma: "22740",
    label: "Código de Procedimiento Civil",
  },
  {
    aliases: ["codigo procesal penal", "código procesal penal", "cpp"],
    idNorma: "176595",
    label: "Código Procesal Penal",
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
  },
  {
    aliases: [
      "codigo de comercio",
      "código de comercio",
      "cdc comercio",
      "comercio codigo",
    ],
    idNorma: "1974",
    label: "Código de Comercio",
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
  },
  {
    aliases: [
      "18575",
      "18.575",
      "loc bases generales",
      "bases generales de la administracion",
      "bases generales de la administración",
    ],
    idNorma: "29967",
    label:
      "Ley N° 18.575 Orgánica Constitucional de Bases Generales de la Administración del Estado",
  },
  {
    aliases: [
      "19880",
      "19.880",
      "ley de procedimientos administrativos",
      "procedimiento administrativo",
      "lbpa",
    ],
    idNorma: "210676",
    label:
      "Ley N° 19.880 sobre Bases de los Procedimientos Administrativos",
  },
  {
    aliases: [
      "19947",
      "19.947",
      "ley de matrimonio civil",
      "matrimonio civil",
    ],
    idNorma: "225128",
    label: "Ley N° 19.947 de Matrimonio Civil",
  },
  {
    aliases: [
      "19968",
      "19.968",
      "tribunales de familia",
      "ley de familia",
    ],
    idNorma: "229557",
    label: "Ley N° 19.968 que Crea los Tribunales de Familia",
  },
  {
    aliases: [
      "20600",
      "20.600",
      "tribunales ambientales",
      "ley ambiental tribunales",
    ],
    idNorma: "1041361",
    label: "Ley N° 20.600 que Crea los Tribunales Ambientales",
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
  },
];

export function resolveHotNorma(
  query: string,
): (typeof HOT_NORMAS)[number] | undefined {
  const q = foldForMatch(query);
  return HOT_NORMAS.find((n) =>
    n.aliases.some((a) => {
      const alias = foldForMatch(a);
      if (q === alias) return true;
      // Whole-word containment only (never a raw substring test): avoids
      // short abbreviations like "cc"/"ct" matching mid-word inside
      // unrelated terms (e.g. "protección" contains the letters "cc").
      return containsWholeAlias(q, alias) || containsWholeAlias(alias, q);
    }),
  );
}

export const HOT_IDS_FOR_WARMUP = HOT_NORMAS.map((n) => n.idNorma);
