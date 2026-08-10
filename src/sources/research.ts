import {
  hotNormasForArea,
  inferLegalArea,
  resolveHotNorma,
  type LegalArea,
} from "../catalog.js";
import { remainingMs, runWithDeadline } from "../deadline.js";
import {
  assistantIntegrityBlock,
  integrityOf,
  sealSearchResponse,
} from "../integrity.js";
import { nextStepFor, toBlockquote } from "../present.js";
import type { SearchResponse } from "../types.js";
import { extractRolMention, normalizeRol } from "../parsers.js";
import { getAdminAdapter, type AdminSourceId } from "./adapter.js";
import { searchDoctrina } from "./doctrina.js";
import {
  obtenerFalloTc,
  resolverRol,
  searchJurisprudencia,
  type ResolveRolResult,
} from "./jurisprudencia.js";
import { searchLegislacion } from "./legislacion.js";
import { findArticulo, parseNormaTexto } from "./normaTexto.js";

function extractArticuloMention(query: string): string | undefined {
  const m = query.match(/art[ií]culo\s*([0-9]+(?:\s*bis)?)/i);
  return m?.[1]?.replace(/\s+/g, " ");
}

function isTcMention(query: string): boolean {
  return /\b(?:tc|tribunal constitucional|ina|inc|cpt|caa|cds)\b/i.test(query);
}

function shouldFetchTcFallo(
  query: string,
  resolved?: ResolveRolResult,
): boolean {
  if (isTcMention(query)) return true;
  return Boolean(
    resolved?.results.some((r) => r.tribunal === "Tribunal Constitucional"),
  );
}

function truncateArticleQuote(texto: string, maxChars: number): string {
  const clean = texto.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}…`;
}

function capMarkdown(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n_…respuesta truncada para no saturar el contexto. Usa obtener_articulo / citar_texto_legal / obtener_fallo_tc para detalle._`;
}

export type PackProgressReporter = (
  progress: number,
  total: number,
  message: string,
) => Promise<void> | void;

export type PackProfile = "fast" | "default" | "deep";

export function resolvePackBudget(perfil?: PackProfile): {
  profile: PackProfile;
  totalMs: number;
  perSourceMs: number;
  doctrinaFast: boolean;
} {
  const fromEnv = (process.env.PACK_PROFILE ?? "").toLowerCase();
  const profile: PackProfile =
    perfil ??
    (fromEnv === "fast" || fromEnv === "deep" || fromEnv === "default"
      ? (fromEnv as PackProfile)
      : "default");

  // Preserve the remote deployment's explicit PACK_TOTAL_MS override.
  if (process.env.PACK_TOTAL_MS && !perfil && !fromEnv) {
    const totalMs = Number(process.env.PACK_TOTAL_MS);
    return {
      profile: "default",
      totalMs,
      perSourceMs: Number(
        process.env.PACK_TIMEOUT_MS ??
          Math.min(11_000, Math.floor(totalMs * 0.65)),
      ),
      doctrinaFast: true,
    };
  }
  if (profile === "fast") {
    return {
      profile,
      totalMs: Number(process.env.PACK_FAST_MS ?? 8_000),
      perSourceMs: Number(process.env.PACK_FAST_TIMEOUT_MS ?? 5_000),
      doctrinaFast: true,
    };
  }
  if (profile === "deep") {
    return {
      profile,
      totalMs: Number(process.env.PACK_DEEP_MS ?? 25_000),
      perSourceMs: Number(process.env.PACK_DEEP_TIMEOUT_MS ?? 16_000),
      doctrinaFast: false,
    };
  }
  const totalMs = Number(process.env.PACK_TOTAL_MS ?? 18_000);
  return {
    profile: "default",
    totalMs,
    perSourceMs: Number(
      process.env.PACK_TIMEOUT_MS ?? Math.min(11_000, Math.floor(totalMs * 0.65)),
    ),
    doctrinaFast: true,
  };
}

export function pickAdminSearch(
  consulta: string,
  area?: LegalArea,
): AdminSourceId {
  if (
    area === "laboral" ||
    /\b(?:dt|direcci[oó]n del trabajo|ord\.?)\b/i.test(consulta)
  ) {
    return "dt";
  }
  if (
    /\b(?:cmf|valores|fintech|banco(?:s)?|mercado financiero)\b/i.test(
      consulta,
    )
  ) {
    return "cmf";
  }
  if (
    area === "consumidor" ||
    /\b(?:sernac|consumidor|ley del consumidor)\b/i.test(consulta)
  ) {
    return "sernac";
  }
  return "cgr";
}

/**
 * Pack orquestado con presupuesto global duro.
 * Diseño: responder siempre antes de PACK_TOTAL_MS con resultados parciales OK.
 * Evita el fallo típico de clientes MCP (~60s) por fases secuenciales sin tope.
 */
export async function investigarTema(
  consulta: string,
  limitePorFuente = 3,
  opts: {
    area?: LegalArea;
    perfil?: PackProfile;
    onProgress?: PackProgressReporter;
  } = {},
): Promise<string> {
  const startedAt = Date.now();
  const { profile, totalMs, perSourceMs, doctrinaFast } = resolvePackBudget(
    opts.perfil,
  );
  const maxChars = Number(process.env.PACK_MAX_CHARS ?? 10_000);
  const articleQuoteChars = Number(process.env.PACK_ARTICLE_CHARS ?? 1_200);
  const pending: string[] = [];
  const area = opts.area ?? inferLegalArea(consulta);
  const areaHot = area ? hotNormasForArea(area) : [];
  const enrichedConsulta =
    area && area !== "general" && !consulta.toLowerCase().includes(area)
      ? `${consulta} ${area}`
      : consulta;
  const rolMention = extractRolMention(consulta);
  const tcMention = isTcMention(consulta);
  const packController = new AbortController();
  const packTimer = setTimeout(() => packController.abort(), totalMs);
  const tick = async (progress: number, message: string) => {
    await opts.onProgress?.(progress, 6, message);
  };

  try {
    await tick(1, "Buscando legislación, jurisprudencia, doctrina y actos administrativos…");
    const adminKind = pickAdminSearch(consulta, area);
    const adminAdapter = getAdminAdapter(adminKind);
    const [leg, juris, doc, dict, rolRes] = await Promise.allSettled([
      runWithDeadline(
        "legislacion",
        perSourceMs,
        (signal) =>
          searchLegislacion(enrichedConsulta, limitePorFuente, { signal }),
        packController.signal,
      ),
      runWithDeadline(
        "jurisprudencia",
        perSourceMs,
        (signal) =>
          searchJurisprudencia(enrichedConsulta, limitePorFuente, {
            signal,
            tribunal:
              area === "constitucional"
                ? "Tribunal Constitucional"
                : undefined,
          }),
        packController.signal,
      ),
      runWithDeadline(
        "doctrina",
        perSourceMs,
        (signal) =>
          searchDoctrina(enrichedConsulta, limitePorFuente, {
            signal,
            fast: doctrinaFast,
          }),
        packController.signal,
      ),
      runWithDeadline(
        "dictamenes",
        perSourceMs,
        (signal) =>
          adminAdapter.search(enrichedConsulta, limitePorFuente, { signal }),
        packController.signal,
      ),
      rolMention
        ? runWithDeadline(
            "resolver_rol",
            perSourceMs,
            (signal) =>
              resolverRol({
                rol: rolMention,
                tribunal: tcMention ? "Tribunal Constitucional" : undefined,
                limite: limitePorFuente,
                signal,
              }),
            packController.signal,
          )
        : Promise.resolve(undefined),
    ]);
    await tick(2, "Fuentes en paralelo listas; armando marco normativo…");

    const rolResolved =
      rolRes.status === "fulfilled" ? rolRes.value : undefined;
    let falloTc: Awaited<ReturnType<typeof obtenerFalloTc>> | undefined;
    if (rolRes.status === "rejected") pending.push("resolver_rol");

    const leftForTc = remainingMs(startedAt, totalMs);
    if (
      rolMention &&
      shouldFetchTcFallo(consulta, rolResolved) &&
      leftForTc >= 2_000
    ) {
      try {
        falloTc = await runWithDeadline(
          "obtener_fallo_tc",
          Math.min(4_000, leftForTc - 200),
          (signal) => obtenerFalloTc(rolMention, signal),
          packController.signal,
        );
      } catch {
        pending.push("obtener_fallo_tc");
      }
    } else if (rolMention && shouldFetchTcFallo(consulta, rolResolved)) {
      pending.push("obtener_fallo_tc (presupuesto agotado)");
    }

    const verifiedItems: string[] = [];
    const candidateItems: string[] = [];
    const portalItems: string[] = [];
    const nextSteps: string[] = [];

    const pushClassified = (
      r: SearchResponse["results"][number],
      label: string,
    ) => {
      const integrity = integrityOf(r);
      const line = `- [${label}] **${r.title}** — ${r.url} (\`${integrity}\`${r.evidence ? `, ${r.evidence}` : ""})`;
      if (integrity === "verified") verifiedItems.push(line);
      else if (integrity === "portal_stub") portalItems.push(line);
      else candidateItems.push(line);
      const next = nextStepFor(r);
      if (next) nextSteps.push(`- ${next}`);
    };

    await tick(3, "Redactando secciones de legislación y texto legal…");
    const sections: string[] = [
      `# Pack de investigación`,
      "",
      `**Consulta:** ${consulta}`,
      area ? `**Área:** \`${area}\`${opts.area ? "" : " _(inferida)_"}` : null,
      `**Perfil:** \`${profile}\``,
      "",
      `_Presupuesto ${totalMs}ms · resultados parciales OK. Usa solo lo listado. Prohibido inventar fallos, dictámenes, artículos o considerandos._`,
      "",
      "_Formato fijo: (1) fuentes por área → (2) clasificación Verificado / Por verificar / Portales → (3) Próximos pasos._",
      "",
    ].filter((x): x is string => x != null);

    sections.push("## 1. Marco normativo");
    if (areaHot.length) {
      sections.push(
        `_Normas frecuentes del área:_ ${areaHot
          .slice(0, 5)
          .map((n) => `${n.label} (\`${n.idNorma}\`)`)
          .join("; ")}`,
      );
    }
    if (leg.status === "fulfilled") {
      if (leg.value.results.length) {
        for (const r of leg.value.results) {
          pushClassified(r, "legislación");
          sections.push(`- **${r.title}**`);
          sections.push(`  - Cita: ${r.citation}`);
          if (r.id) sections.push(`  - idNorma: \`${r.id}\``);
          sections.push(`  - URL: ${r.url}`);
          if (r.id) {
            sections.push(
              `  - → \`citar_texto_legal\` / \`obtener_articulo\` con idNorma \`${r.id}\``,
            );
            nextSteps.push(
              `- Obtener texto: \`citar_texto_legal\` / \`obtener_articulo\` idNorma \`${r.id}\`.`,
            );
          }
        }
      } else {
        sections.push(
          "- Sin coincidencias de legislación para esta consulta (búsqueda completada).",
        );
        if (leg.value.warnings?.length) {
          for (const w of leg.value.warnings.slice(0, 2)) {
            sections.push(`  - _${w}_`);
          }
        }
      }
    } else if (areaHot.length) {
      pending.push("legislacion");
      for (const n of areaHot.slice(0, limitePorFuente)) {
        sections.push(`- **${n.label}** _(catálogo hot · área ${area})_`);
        sections.push(`  - idNorma: \`${n.idNorma}\``);
        sections.push(
          `  - URL: https://www.bcn.cl/leychile/navegar?idNorma=${n.idNorma}`,
        );
        sections.push(
          `  - → \`mapa_norma\` / \`citar_texto_legal\` con idNorma \`${n.idNorma}\``,
        );
      }
    } else {
      pending.push("legislacion");
      sections.push("- Sin resultados de legislación en el tiempo disponible.");
    }

    const articulo = extractArticuloMention(consulta);
    const hot = resolveHotNorma(consulta) ?? areaHot[0];
    const idFromLeg =
      leg.status === "fulfilled"
        ? leg.value.results.find((r) => r.id)?.id
        : undefined;
    const idNorma = hot?.idNorma ?? idFromLeg;
    const leftForXml = remainingMs(startedAt, totalMs);
    if (idNorma && articulo && leftForXml >= 1_500) {
      sections.push("", "## 1.b Texto legal citado (oficial LeyChile)");
      try {
        const norma = await runWithDeadline(
          "xml_articulo",
          Math.min(4_000, leftForXml - 200),
          (signal) =>
            parseNormaTexto(String(idNorma), {
              signal,
              timeoutMs: 8_000,
              retries: 1,
            }),
          packController.signal,
        );
        const art = findArticulo(norma, articulo);
        if (art) {
          const quote = truncateArticleQuote(art.texto, articleQuoteChars);
          const artLines = [
            `**${norma.tipo ?? "Norma"} ${norma.numero}, art. ${art.numero}** — ${norma.titulo}`,
            art.url,
            "",
            ...quote.split(/(?<=\.)\s+/).map((line) => `> ${line}`),
            "",
            `_Cita sugerida: ${norma.tipo ?? "Norma"} N° ${norma.numero}, art. ${art.numero}._`,
          ];
          if (art.texto.length > articleQuoteChars) {
            artLines.push(
              `_Extracto truncado (${articleQuoteChars} chars). Usa citar_texto_legal / obtener_articulo para el íntegro._`,
            );
          }
          sections.push(...artLines);
          verifiedItems.push(
            `- [legislación] **${norma.tipo ?? "Norma"} ${norma.numero}, art. ${art.numero}** — ${art.url} (\`verified\`, full_text)`,
          );
        } else {
          sections.push(
            `No se encontró art. ${articulo}. Índice: ${norma.articulos
              .map((a) => a.numero)
              .slice(0, 20)
              .join(", ")}`,
          );
        }
      } catch (error) {
        pending.push("xml_articulo");
        sections.push(
          `No se pudo traer el XML (${error instanceof Error ? error.message : String(error)}).`,
          `URL: https://www.bcn.cl/leychile/navegar?idNorma=${idNorma}`,
        );
      }
    } else if (idNorma && articulo) {
      pending.push("xml_articulo (presupuesto agotado)");
      sections.push(
        "",
        `_Hay idNorma=${idNorma} art. ${articulo}, pero el presupuesto del pack se agotó. Usa citar_texto_legal._`,
      );
    } else if (idNorma) {
      sections.push(
        "",
        `_Norma candidata idNorma=${idNorma}. Usa citar_texto_legal / obtener_articulo para el cuerpo._`,
      );
    }

    if (rolMention) {
      sections.push("", "## 1.c ROL detectado");
      if (rolResolved) {
        sections.push(
          `**ROL normalizado:** ${normalizeRol(rolMention).display}`,
        );
        sections.push(`**Cita sugerida:** ${rolResolved.citation}`);
        const tcResults = rolResolved.results.filter(
          (r) => r.tribunal === "Tribunal Constitucional",
        );
        const otherResults = rolResolved.results.filter(
          (r) => r.tribunal !== "Tribunal Constitucional",
        );
        if (tcResults.length) {
          sections.push("", "**Candidatos TC:**");
          for (const r of tcResults.slice(0, limitePorFuente)) {
            sections.push(
              `- ${r.citation} — ${r.url}${r.secondaryUrl ? ` (PDF: ${r.secondaryUrl})` : ""}`,
            );
          }
        }
        if (otherResults.length) {
          sections.push("", "**Candidatos PJUD / otros portales:**");
          for (const r of otherResults.slice(0, limitePorFuente)) {
            sections.push(`- ${r.title} — ${r.url}`);
          }
        }
        if (falloTc) {
          const shortExcerpt = truncateArticleQuote(falloTc.excerpt, 900);
          sections.push(
            "",
            "### Extracto oficial TC",
            "",
            "**Cita lista para pegar:**",
            "",
            `> ${falloTc.citation}`,
            "",
            falloTc.url,
            "",
            toBlockquote(shortExcerpt, 6),
            "",
            "→ Más detalle / PDF: `obtener_fallo_tc`. Cita por considerando: `citar_jurisprudencia`.",
          );
          verifiedItems.push(
            `- [jurisprudencia TC] **${falloTc.citation}** — ${falloTc.url} (\`verified\`)`,
          );
          nextSteps.push(
            `- Citar considerando: \`citar_jurisprudencia\` con rol \`${normalizeRol(rolMention).display}\`.`,
          );
        }
        if (rolResolved.warnings.length) {
          sections.push(
            "",
            ...rolResolved.warnings
              .slice(0, 3)
              .map((w) => `- _Advertencia ROL:_ ${w}`),
          );
        }
      } else {
        sections.push("- No se pudo resolver el ROL en el tiempo disponible.");
      }
    }

    const dumpSource = (
      title: string,
      result: PromiseSettledResult<SearchResponse>,
      label: string,
    ) => {
      sections.push("", `## ${title}`);
      if (result.status !== "fulfilled") {
        pending.push(label);
        const reason =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        const soft = /aborted|timeout|deadline|Deadline/i.test(reason)
          ? `Fuente incompleta por timeout (~${perSourceMs}ms); el pack sigue con lo disponible. Reintenta la fuente sola o sube PACK_TIMEOUT_MS.`
          : `Fuente incompleta: ${reason}`;
        sections.push(`- ${soft}`);
        return;
      }
      const sealed = sealSearchResponse(result.value);
      if (!sealed.results.length) {
        sections.push(
          "- Sin hallazgos verificables. No inventes fuentes para esta sección.",
        );
        return;
      }
      for (const r of sealed.results.slice(0, limitePorFuente)) {
        pushClassified(r, label);
        const integrity = integrityOf(r);
        sections.push(`- **${r.title}**`);
        sections.push(`  - Cita: ${r.citation}`);
        const meta = [
          r.rol ? `ROL \`${r.rol}\`` : null,
          r.tribunal,
          `integridad=\`${integrity}\``,
          r.evidence ? `evidencia=${r.evidence}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        if (meta) sections.push(`  - ${meta}`);
        sections.push(`  - URL: ${r.url}`);
        if (label === "doctrina" && r.summary) {
          sections.push(
            `  - Abstract: ${String(r.summary).replace(/\s+/g, " ").slice(0, 200)}…`,
          );
        }
        const next = nextStepFor(r);
        if (next) sections.push(`  - → ${next.replace(/^Siguiente:\s*/i, "")}`);
      }
      if (sealed.warnings?.length) {
        sections.push(
          ...sealed.warnings.slice(0, 3).map((w) => `  - _Advertencia:_ ${w}`),
        );
      }
    };

    await tick(4, "Compilando jurisprudencia, actos administrativos y doctrina…");
    dumpSource(
      "2. Jurisprudencia (verificar texto oficial)",
      juris,
      "jurisprudencia",
    );
    dumpSource(
      `3. Actos administrativos (${adminKind === "cgr" ? "CGR" : adminKind.toUpperCase()}; verificar texto oficial)`,
      dict,
      "dictamenes",
    );
    dumpSource("4. Doctrina académica (no vinculante)", doc, "doctrina");

    await tick(5, "Cerrando lagunas y advertencias de integrity…");
    const elapsed = Date.now() - startedAt;
    const uniq = (items: string[]) => [...new Set(items)];

    sections.push("", "## 5. Clasificación por integridad");
    sections.push("", "### Verificado");
    sections.push(
      ...(uniq(verifiedItems).slice(0, 12).length
        ? uniq(verifiedItems).slice(0, 12)
        : [
            "- _(Vacío en este pack.) Baja a `citar_texto_legal` / `obtener_fallo_tc` / texto pegado._",
          ]),
    );
    sections.push("", "### Por verificar");
    sections.push(
      ...(uniq(candidateItems).slice(0, 12).length
        ? uniq(candidateItems).slice(0, 12)
        : ["- _(Ningún candidato en este pack.)_"]),
    );
    sections.push("", "### Portales sugeridos");
    sections.push(
      ...(uniq(portalItems).slice(0, 8).length
        ? uniq(portalItems).slice(0, 8)
        : ["- _(Ningún portal_stub en este pack.)_"]),
    );

    sections.push("", "## 6. Próximos pasos");
    const defaultNext = [
      "- Confirma vigencia en LeyChile antes de asesorar.",
      "- Fallos PJUD: pega el texto en `pegar_fallo_pjud` (o `citar_jurisprudencia` con `texto`).",
      "- Dictámenes CGR: pega el texto en `citar_dictamen_pegado` tras `resolver_dictamen`.",
      "- Para estructurar el entregable: `asesorar` / `flujo_estudio` / `plantilla_escrito` / `minuta_cliente`.",
    ];
    sections.push(...uniq(nextSteps).slice(0, 8), ...defaultNext);

    sections.push("", "## 7. Lagunas / verificación pendiente");
    if (pending.length) {
      sections.push(
        `- Fuentes incompletas por timeout/error (respuesta parcial OK): ${pending.join(", ")}. Puedes consultar cada fuente con su tool dedicada.`,
      );
    }
    sections.push(
      `- Tiempo pack: ${elapsed}ms (tope ${totalMs}ms).`,
      "- No cites ratio decidendi desde títulos de links (evidence=link_only / portal_stub).",
      "- Doctrina: metadata OA (no vinculante); preferir LeyChile para normas.",
      "- Si una sección dice «Sin hallazgos», no completes con memoria ni fuentes no listadas.",
      "- Este pack no constituye asesoría jurídica formal.",
      "",
      assistantIntegrityBlock(),
    );

    await tick(6, "Pack listo");
    return capMarkdown(sections.join("\n"), maxChars);
  } finally {
    clearTimeout(packTimer);
  }
}
