/** Catálogo curado de revistas jurídicas chilenas y latinoamericanas enlazables vía OpenAlex/SciELO. */
export type LatamCountry = "CL" | "PE" | "BR" | "AR" | "MX" | "CO";

export interface LegalJournal {
  name: string;
  country: LatamCountry;
  issns: string[];
  /** Colección ArticleMeta SciELO (chl, scl, arg, mex, per, col). */
  collection?: string;
  scielo?: string;
  publisher?: string;
  homepage?: string;
}

export const CHILE_LEGAL_JOURNALS: LegalJournal[] = [
  {
    name: "Revista Chilena de Derecho",
    country: "CL",
    issns: ["0716-0747", "0718-3437"],
    collection: "chl",
    scielo: "rchilder",
    publisher: "Pontificia Universidad Católica de Chile",
  },
  {
    name: "Revista chilena de derecho privado",
    country: "CL",
    issns: ["0718-0233", "0718-8072"],
    collection: "chl",
    scielo: "rchdp",
    publisher: "Universidad de Chile",
  },
  {
    name: "Ius et Praxis",
    country: "CL",
    issns: ["0717-2877", "0718-0012"],
    collection: "chl",
    scielo: "ieprax",
    publisher: "Universidad de Talca",
  },
  {
    name: "Revista de derecho (Valparaíso)",
    country: "CL",
    issns: ["0716-1883", "0718-6851"],
    collection: "chl",
    scielo: "rderecho",
  },
  {
    name: "Revista de derecho (Coquimbo)",
    country: "CL",
    issns: ["0717-5345", "0718-9753"],
    collection: "chl",
    scielo: "rdcoquim",
  },
  {
    name: "Revista de Derecho Público",
    country: "CL",
    issns: ["0716-0267", "0719-5249"],
    publisher: "Universidad de Chile",
    homepage: "http://www.revistaderechopublico.uchile.cl",
  },
  {
    name: "Revista Chilena de Derecho y Tecnología",
    country: "CL",
    issns: ["0719-2576", "0719-2584"],
    publisher: "Universidad de Chile",
    homepage: "http://www.rchdt.uchile.cl",
  },
  {
    name: "Revista Chilena de Derecho Informático",
    country: "CL",
    issns: ["0717-9162"],
  },
  {
    name: "Revista Chilena de Derecho y Ciencia Política",
    country: "CL",
    issns: ["0718-9389", "0719-2150"],
    homepage: "http://www.derechoycienciapolitica.cl",
  },
  {
    name: "Revista de Derecho Ambiental",
    country: "CL",
    issns: ["0718-0101", "0719-4633"],
    publisher: "Universidad de Chile",
    homepage: "https://revistaderechoambiental.uchile.cl",
  },
  {
    name: "Revista de derecho (Universidad de Concepción)",
    country: "CL",
    issns: ["0303-9986", "0718-591X"],
    collection: "chl",
    scielo: "rderecho",
  },
  {
    name: "Revista de Derecho Administrativo Económico",
    country: "CL",
    issns: ["0717-4888", "0719-5591"],
    publisher: "Universidad de Chile",
    homepage: "http://redae.uc.cl",
  },
  {
    name: "Revista chilena de historia del derecho",
    country: "CL",
    issns: ["0716-5447"],
    publisher: "Universidad de Chile",
    homepage: "http://www.historiadelderecho.uchile.cl",
  },
  {
    name: "Revista de Derecho Económico",
    country: "CL",
    issns: ["0716-310X", "0719-7462"],
    publisher: "Universidad de Chile",
  },
  {
    name: "Revista Chilena de Derecho del Trabajo y de la Seguridad Social",
    country: "CL",
    issns: ["0719-0093", "0719-7551"],
    publisher: "Universidad de Chile",
    homepage: "http://www.revistatrabajo.uchile.cl",
  },
  {
    name: "Revista de Derecho Escuela de Postgrado",
    country: "CL",
    issns: ["0719-1731", "0719-5516"],
    collection: "chl",
    scielo: "rdep",
  },
  {
    name: "Derecho y Humanidades",
    country: "CL",
    issns: ["0716-9825", "0719-2517"],
  },
  {
    name: "Revista Pedagogía Universitaria y Didáctica del Derecho",
    country: "CL",
    issns: ["0719-5885"],
    publisher: "Universidad de Chile",
    homepage: "http://www.pedagogiaderecho.uchile.cl",
  },
  {
    name: "Justicia & Derecho",
    country: "CL",
    issns: ["0719-9392"],
    publisher: "Universidad Autónoma de Chile",
    homepage: "https://revistas.uautonoma.cl/index.php/rjyd",
  },
  {
    name: "Revista latinoamericana de derecho y religión",
    country: "CL",
    issns: ["0719-7160"],
    homepage: "http://www.revistalatderechoyreligion.com",
  },
  {
    name: "Revista de Derecho",
    country: "CL",
    issns: ["0717-0599", "2735-6337"],
  },
  {
    name: "Derecho y Justicia",
    country: "CL",
    issns: ["0719-1685", "0719-6377"],
    publisher: "Universidad Católica de Santísima Concepción",
    homepage: "http://ediciones.ucsh.cl/ojs",
  },
];

/** Bloque de referencia latinoamericano (Perú, Brasil, Argentina, México, Colombia). */
export const LATAM_REFERENCE_JOURNALS: LegalJournal[] = [
  // Perú
  {
    name: "Derecho PUCP",
    country: "PE",
    issns: ["0251-3420", "2305-2546"],
    collection: "per",
    publisher: "Pontificia Universidad Católica del Perú",
    homepage: "http://revistas.pucp.edu.pe/index.php/derechopucp",
  },
  {
    name: "THEMIS Revista de Derecho",
    country: "PE",
    issns: ["1810-9934", "2410-9592"],
    collection: "per",
    publisher: "PUCP",
    homepage: "http://revistas.pucp.edu.pe/themis",
  },
  {
    name: "Derecho & Sociedad",
    country: "PE",
    issns: ["2079-3634", "2521-599X"],
    publisher: "PUCP",
    homepage: "http://revistas.pucp.edu.pe/index.php/derechoysoci",
  },
  // Brasil
  {
    name: "Revista Direito GV",
    country: "BR",
    issns: ["1808-2432", "2317-6172"],
    collection: "scl",
    scielo: "rdgv",
    publisher: "FGV Direito SP",
    homepage: "https://www.scielo.br/j/rdgv",
  },
  {
    name: "Revista Direito e Práxis",
    country: "BR",
    issns: ["2179-8966"],
    publisher: "UERJ",
    homepage: "https://www.scielo.br/j/rdp",
  },
  // Argentina
  {
    name: "Prudentia Iuris",
    country: "AR",
    issns: ["0326-2774", "2524-9525"],
    collection: "arg",
    publisher: "PUC Argentina",
    homepage:
      "https://www.scielo.org.ar/scielo.php?script=sci_serial&pid=2524-9525",
  },
  {
    name: "Revista de Historia del Derecho",
    country: "AR",
    issns: ["0325-1918", "1853-1784"],
    collection: "arg",
    scielo: "rhd",
    publisher: "Instituto de Investigaciones de Historia del Derecho",
    homepage:
      "https://www.scielo.org.ar/scielo.php?script=sci_serial&pid=1853-1784",
  },
  // México
  {
    name: "Boletín Mexicano de Derecho Comparado",
    country: "MX",
    issns: ["0041-8633", "2448-4873"],
    collection: "mex",
    publisher: "UNAM",
    homepage:
      "https://www.scielo.org.mx/scielo.php?script=sci_serial&pid=0041-8633",
  },
  {
    name: "Cuestiones Constitucionales. Revista Mexicana de Derecho Constitucional",
    country: "MX",
    issns: ["1405-9193", "2448-4881"],
    collection: "mex",
    publisher: "UNAM",
    homepage:
      "https://revistas.juridicas.unam.mx/index.php/cuestiones-constitucionales",
  },
  {
    name: "Problema. Anuario de Filosofía y Teoría del Derecho",
    country: "MX",
    issns: ["2007-4387", "2448-7937"],
    collection: "mex",
    publisher: "UNAM",
    homepage: "https://revistas.juridicas.unam.mx/index.php/filosofia-derecho",
  },
  {
    name: "Revista de la Facultad de Derecho de México",
    country: "MX",
    issns: ["1870-8722", "2448-8933", "0185-1810"],
    collection: "mex",
    publisher: "UNAM",
    homepage: "https://revistas.juridicas.unam.mx/index.php/derecho",
  },
  // Colombia
  {
    name: "Revista Derecho del Estado",
    country: "CO",
    issns: ["0122-9893", "2346-2051"],
    collection: "col",
    publisher: "Universidad Externado de Colombia",
    homepage: "https://revistas.uexternado.edu.co/index.php/derest",
  },
  {
    name: "Revista de Derecho Privado",
    country: "CO",
    issns: ["0123-4366", "2346-2442"],
    collection: "col",
    publisher: "Universidad Externado de Colombia",
    homepage: "https://revistas.uexternado.edu.co/index.php/derpri",
  },
  {
    name: "Revista de Derecho Público",
    country: "CO",
    issns: ["0121-5868", "1909-7778"],
    publisher: "Universidad de los Andes",
    homepage: "http://derechopublico.uniandes.edu.co",
  },
];

export const ALL_LEGAL_JOURNALS: LegalJournal[] = [
  ...CHILE_LEGAL_JOURNALS,
  ...LATAM_REFERENCE_JOURNALS,
];

export function chileLegalJournalIssns(): string[] {
  return uniqueIssns(CHILE_LEGAL_JOURNALS);
}

export function issnsForCountry(country: LatamCountry): string[] {
  if (country === "CL") return chileLegalJournalIssns();
  return uniqueIssns(
    LATAM_REFERENCE_JOURNALS.filter((j) => j.country === country),
  );
}

export function journalByIssn(issn?: string): LegalJournal | undefined {
  if (!issn) return undefined;
  const norm = issn.replace(/\s/g, "");
  return ALL_LEGAL_JOURNALS.find((j) => j.issns.includes(norm));
}

export function inferCollectionFromDoi(doi: string): string | undefined {
  const norm = doi.replace(/^https?:\/\/doi\.org\//i, "").toLowerCase();
  if (norm.startsWith("10.4067/")) return "chl";
  if (norm.startsWith("10.1590/")) return "scl";
  if (norm.startsWith("10.17135/") || norm.startsWith("10.46553/"))
    return "arg";
  if (norm.startsWith("10.22201/")) return "mex";
  if (norm.startsWith("10.18800/")) return "per";
  return undefined;
}

function uniqueIssns(journals: LegalJournal[]): string[] {
  return [...new Set(journals.flatMap((j) => j.issns))];
}

export const LATAM_COUNTRY_LABELS: Record<LatamCountry, string> = {
  CL: "Chile",
  PE: "Perú",
  BR: "Brasil",
  AR: "Argentina",
  MX: "México",
  CO: "Colombia",
};
