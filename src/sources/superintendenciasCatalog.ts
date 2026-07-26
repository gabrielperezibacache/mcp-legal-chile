import { containsWholeAlias, foldForMatch } from "../textMatch.js";

/**
 * Catálogo estático de superintendencias y otros organismos administrativos
 * chilenos sin API pública documentada. Mismo patrón que
 * `tribunalesCatalog.ts`: portal_stub/link_only desde el día uno (valor
 * inmediato sin depender de scraping frágil). Cada builder de URL apunta al
 * buscador oficial del organismo, nunca a texto ya extraído.
 */
export interface SuperintendenciaPortal {
  id: string;
  name: string;
  aliases: string[];
  sites: string[];
  searchUrl: (query: string) => string;
  notes?: string;
}

export const SUPERINTENDENCIAS: SuperintendenciaPortal[] = [
  {
    id: "cmf",
    name: "Comisión para el Mercado Financiero (ex-SBIF/SVS)",
    aliases: [
      "cmf",
      "comision para el mercado financiero",
      "comisión para el mercado financiero",
      "sbif",
      "svs",
      "superintendencia de bancos",
      "superintendencia de valores y seguros",
    ],
    sites: ["cmfchile.cl"],
    searchUrl: (query) =>
      `https://www.cmfchile.cl/institucional/legislacion_normativa/normativa.php?texto=${encodeURIComponent(query)}`,
    notes:
      "Consulta Global de normativa (NCG/circulares/oficios circulares) desde 1981; sin API pública documentada.",
  },
  {
    id: "superdesalud",
    name: "Superintendencia de Salud",
    aliases: [
      "superintendencia de salud",
      "superdesalud",
      "isapres",
      "ges",
    ],
    sites: ["superdesalud.gob.cl"],
    searchUrl: (query) =>
      `https://www.superdesalud.gob.cl/?s=${encodeURIComponent(query)}`,
    notes:
      "Compendios de normas administrativas (ISAPREs/FONASA/GES); buscador propio por palabras clave.",
  },
  {
    id: "suseso",
    name: "Superintendencia de Seguridad Social",
    aliases: ["suseso", "seguridad social", "licencia medica", "licencia médica"],
    sites: ["suseso.gob.cl"],
    searchUrl: (query) =>
      `https://www.suseso.gob.cl/612/w3-propertyvalue-10372.html?query=${encodeURIComponent(query)}`,
    notes:
      "Buscadores dedicados de Circulares y Dictámenes SUSESO (normativa + jurisprudencia administrativa).",
  },
  {
    id: "sec",
    name: "Superintendencia de Electricidad y Combustibles",
    aliases: ["sec", "electricidad y combustibles", "sec chile"],
    sites: ["sec.cl"],
    searchUrl: () => "https://www.sec.cl/centro-de-descargas/",
    notes:
      "Centro de descargas con normativa técnica (RIC, decretos tarifarios); textos declarados no oficiales por el propio organismo.",
  },
  {
    id: "superir",
    name: "Superintendencia de Insolvencia y Reemprendimiento",
    aliases: [
      "superir",
      "insolvencia y reemprendimiento",
      "boletin concursal",
      "boletín concursal",
    ],
    sites: ["superir.gob.cl"],
    searchUrl: () => "https://www.superir.gob.cl/transparencia/normativa_a7c.html",
    notes: "Marco normativo (Ley 20.720 y normas de carácter general) vía portal de transparencia.",
  },
];

export function matchSuperintendencia(
  query?: string,
): SuperintendenciaPortal | undefined {
  if (!query) return undefined;
  const q = foldForMatch(query);
  return SUPERINTENDENCIAS.find((s) => {
    const name = foldForMatch(s.name);
    if (name === q) return true;
    return s.aliases.some((a) => {
      const alias = foldForMatch(a);
      if (!alias) return false;
      return containsWholeAlias(q, alias) || containsWholeAlias(alias, q);
    });
  });
}
