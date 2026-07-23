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
];

export function resolveHotNorma(
  query: string,
): (typeof HOT_NORMAS)[number] | undefined {
  const q = query.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();
  return HOT_NORMAS.find((n) =>
    n.aliases.some((a) => {
      const alias = a.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
      return q === alias || q.includes(alias) || alias.includes(q);
    }),
  );
}

export const HOT_IDS_FOR_WARMUP = HOT_NORMAS.map((n) => n.idNorma);
