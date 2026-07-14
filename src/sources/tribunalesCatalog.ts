/** Portales oficiales de jurisprudencia y búsqueda por tribunal. */
export interface TribunalPortal {
  id: string;
  name: string;
  aliases: string[];
  sites: string[];
  searchUrl?: (rol: string) => string;
  notes?: string;
}

export const TRIBUNAL_PORTALS: TribunalPortal[] = [
  {
    id: "tc",
    name: "Tribunal Constitucional",
    aliases: ["tribunal constitucional", "tc", "t.c."],
    sites: ["tribunalconstitucional.cl", "buscador.tcchile.cl"],
    searchUrl: (rol) =>
      `https://buscador.tcchile.cl/#/?q=${encodeURIComponent(rol)}`,
    notes: "API pública buscador-backend.tcchile.cl (metadatos + texto).",
  },
  {
    id: "cs",
    name: "Corte Suprema",
    aliases: ["corte suprema", "cs", "excelentísima"],
    sites: ["pjud.cl"],
    searchUrl: () => "https://www.pjud.cl/portal-unificado-sentencias",
    notes: "Sin API abierta; portal con CAPTCHA.",
  },
  {
    id: "ca",
    name: "Corte de Apelaciones",
    aliases: ["corte de apelaciones", "ca ", "apelaciones"],
    sites: ["pjud.cl"],
    searchUrl: () => "https://www.pjud.cl/portal-unificado-sentencias",
  },
  {
    id: "civil",
    name: "Juzgado Civil",
    aliases: ["civil", "juzgado civil"],
    sites: ["pjud.cl"],
    searchUrl: () => "https://www.pjud.cl/portal-unificado-sentencias",
  },
  {
    id: "familia",
    name: "Juzgado de Familia",
    aliases: ["familia", "juzgado de familia", "familiar"],
    sites: ["pjud.cl"],
    searchUrl: () => "https://www.pjud.cl/portal-unificado-sentencias",
  },
  {
    id: "garantia",
    name: "Juzgado de Garantía",
    aliases: ["garantía", "garantia", "juzgado de garantía"],
    sites: ["pjud.cl"],
    searchUrl: () => "https://www.pjud.cl/portal-unificado-sentencias",
  },
  {
    id: "oral_penal",
    name: "Tribunal de Juicio Oral en lo Penal",
    aliases: ["top", "oral en lo penal", "juicio oral", "tribunal oral", "tribunal oral en lo penal"],
    sites: ["pjud.cl"],
    searchUrl: () => "https://www.pjud.cl/portal-unificado-sentencias",
  },
  {
    id: "laboral",
    name: "Juzgado / Corte Laboral",
    aliases: ["laboral", "dt", "tribunal laboral"],
    sites: ["pjud.cl"],
    searchUrl: () => "https://www.pjud.cl/portal-unificado-sentencias",
  },
  {
    id: "cobranza",
    name: "Juzgado de Cobranza",
    aliases: ["cobranza", "previsional"],
    sites: ["pjud.cl"],
    searchUrl: () => "https://www.pjud.cl/portal-unificado-sentencias",
  },
  {
    id: "tdlc",
    name: "Tribunal de Defensa de la Libre Competencia",
    aliases: ["tdlc", "libre competencia", "fne"],
    sites: ["tdlc.cl", "fne.gob.cl"],
    searchUrl: (rol) =>
      `https://www.tdlc.cl/Consulta/search?q=${encodeURIComponent(rol)}`,
  },
  {
    id: "tdpi",
    name: "Tribunal de Propiedad Industrial",
    aliases: ["tdpi", "propiedad industrial", "inapi"],
    sites: ["tdpi.cl"],
    searchUrl: (rol) =>
      `https://www.tdpi.cl/buscador?query=${encodeURIComponent(rol)}`,
  },
  {
    id: "tcp",
    name: "Tribunal de Contratación Pública",
    aliases: [
      "tcp",
      "contratacion publica",
      "contratación pública",
      "chilecompra",
    ],
    sites: ["chilecompra.cl"],
    searchUrl: () =>
      "https://www.chilecompra.cl/tribunal-de-contratacion-publica/",
  },
  {
    id: "1ta",
    name: "Primer Tribunal Ambiental",
    aliases: ["1ta", "primer tribunal ambiental", "primero ambiental"],
    sites: ["1ta.cl"],
    searchUrl: () => "https://www.1ta.cl/jurisprudencia/",
  },
  {
    id: "2ta",
    name: "Segundo Tribunal Ambiental",
    aliases: ["2ta", "segundo tribunal ambiental", "segundo ambiental"],
    sites: ["2ta.cl"],
    searchUrl: () => "https://www.2ta.cl/jurisprudencia/",
  },
  {
    id: "3ta",
    name: "Tercer Tribunal Ambiental",
    aliases: ["3ta", "tribunal ambiental", "tercer tribunal ambiental"],
    sites: ["3ta.cl"],
    searchUrl: () => "https://www.3ta.cl/jurisprudencia/",
  },
  {
    id: "tce",
    name: "Tribunal Calificador de Elecciones",
    aliases: [
      "tce",
      "calificador de elecciones",
      "tribunal calificador",
      "tribunal calificador de elecciones",
    ],
    sites: ["tse.cl", "tribunalelectoral.cl"],
    searchUrl: () => "https://www.tribunalelectoral.cl/",
  },
  {
    id: "ter",
    name: "Tribunal Electoral Regional",
    aliases: ["ter", "tribunal electoral regional"],
    sites: ["tse.cl", "tribunalelectoral.cl"],
    searchUrl: () => "https://www.tribunalelectoral.cl/",
  },
  {
    id: "tta",
    name: "Tribunales Tributarios y Aduaneros",
    aliases: [
      "tta",
      "tributario",
      "aduanero",
      "tribunal tributario",
      "tribunal aduanero",
    ],
    sites: ["tribunalesaduaneros.cl", "tgr.cl"],
    searchUrl: () => "https://www.tribunalesaduaneros.cl/",
  },
];

export function matchTribunalPortal(
  tribunal?: string,
): TribunalPortal | undefined {
  if (!tribunal) return undefined;
  const t = tribunal.toLowerCase();
  return TRIBUNAL_PORTALS.find(
    (p) =>
      p.name.toLowerCase() === t ||
      p.aliases.some((a) => t.includes(a) || a.includes(t)),
  );
}

export function tribunalSearchSites(tribunal?: string): string[] {
  const portal = matchTribunalPortal(tribunal);
  if (portal) return [...portal.sites];
  return ["pjud.cl", "tribunalconstitucional.cl"];
}

export function buildPortalLinks(
  rol: string,
  tribunal?: string,
): Record<string, string> {
  const links: Record<string, string> = {
    poderJudicial: "https://www.pjud.cl/portal-unificado-sentencias",
    busquedaPjud: `https://duckduckgo.com/?q=${encodeURIComponent(`rol ${rol} site:pjud.cl`)}`,
  };
  const portal = matchTribunalPortal(tribunal);
  if (portal?.searchUrl) {
    links[portal.id] = portal.searchUrl(rol);
  }
  if (!portal || portal.id !== "tc") {
    links.tcBuscador = `https://buscador.tcchile.cl/#/?q=${encodeURIComponent(rol)}`;
  }
  return links;
}
