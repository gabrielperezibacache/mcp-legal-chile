export interface ChileanCitationInput {
  tipo?: string;
  numero?: string;
  articulo?: string;
  inciso?: string;
  letra?: string;
  rol?: string;
  tribunal?: string;
  dictamen?: string;
  anio?: string;
  titulo?: string;
  url?: string;
}

/** Format citations for Chilean legal writing from already-fetched identifiers. */
export function formatChileanCitation(input: ChileanCitationInput): {
  citation: string;
  url?: string;
  notes: string[];
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
    };
  }

  if (input.rol) {
    const tribunal = input.tribunal ? `${input.tribunal}, ` : "";
    const citation = `${tribunal}rol ${input.rol}${input.anio ? ` (${input.anio})` : ""}`;
    return { citation, url: input.url, notes };
  }

  const parts: string[] = [];
  const tipo = input.tipo?.trim() || "Norma";
  if (input.numero) {
    const num = input.numero.includes(".")
      ? input.numero
      : input.numero.replace(/^(\d{1,2})(\d{3})$/, "$1.$2");
    parts.push(`${tipo} N° ${num}`);
  } else if (input.titulo) {
    parts.push(input.titulo);
  } else {
    parts.push(tipo);
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
  };
}
