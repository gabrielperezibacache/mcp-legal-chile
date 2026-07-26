import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buscarCausaPjud,
  obtenerCausaPjud,
  PjudCausasCaptchaError,
  PjudCausasNoResultsError,
  PjudCausasSolverBudgetError,
  PjudCausasTimeoutError,
} from "../sources/index.js";
import type { CausaPjud, CausaPjudSearchResponse } from "../types.js";
import { formatResultsJson } from "../util.js";
import { fail, formatoSchema, okText, timedSearch } from "./helpers.js";

function formatCausaMarkdown(causa: CausaPjud): string {
  const lines: string[] = [`### ${causa.caratulado ?? "Causa"}`, ""];
  const ids: string[] = [];
  if (causa.rol) ids.push(`ROL \`${causa.rol}\``);
  if (causa.rit) ids.push(`RIT \`${causa.rit}\``);
  if (causa.ruc) ids.push(`RUC \`${causa.ruc}\``);
  if (ids.length) lines.push(`- **Identificadores:** ${ids.join(" · ")}`);
  lines.push(`- **Tribunal:** ${causa.tribunal}`);
  if (causa.estado) lines.push(`- **Estado:** ${causa.estado}`);
  if (causa.fecha) lines.push(`- **Fecha:** ${causa.fecha}`);
  if (causa.litigantes?.length)
    lines.push(`- **Litigantes:** ${causa.litigantes.join(", ")}`);
  if (causa.ultimaActuacion)
    lines.push(`- **Última actuación:** ${causa.ultimaActuacion}`);
  lines.push(
    `- **Integridad:** candidato (scraping vía workaround CAPTCHA — verificar en el portal)`,
  );
  lines.push(`- **URL:** ${causa.url}`);

  if (causa.movimientos?.length) {
    lines.push("", "**Movimientos:**", "");
    for (const mov of causa.movimientos) {
      const parts = [mov.fecha, mov.etapa, mov.tramite].filter(Boolean);
      lines.push(`- ${parts.join(" — ")}`);
    }
  }

  lines.push("", `> ${causa.warning}`);
  return lines.join("\n");
}

function formatCausaSearchMarkdown(response: CausaPjudSearchResponse): string {
  const lines: string[] = [
    "## Resultados — Causas PJUD (Oficina Judicial Virtual)",
    "",
    `| | |`,
    `|---|---|`,
    `| **Consulta** | ${response.query} |`,
    `| **Causas encontradas** | ${response.results.length} |`,
    "",
  ];

  if (response.results.length === 0) {
    lines.push("No hay causas verificables para esta consulta.", "");
  } else {
    for (const [i, causa] of response.results.entries()) {
      lines.push(`#### ${i + 1}.`, formatCausaMarkdown(causa), "");
    }
  }

  if (response.warnings.length) {
    lines.push("### Advertencias", "");
    for (const w of response.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  if (response.searchUrls && Object.keys(response.searchUrls).length) {
    lines.push("### Buscadores oficiales", "");
    for (const [name, url] of Object.entries(response.searchUrls)) {
      lines.push(`- [${name}](${url})`);
    }
    lines.push("");
  }

  lines.push(
    "### Integridad (obligatorio)",
    "- Estos datos provienen de scraping no oficial (workaround de CAPTCHA), NO de una API validada por PJUD.",
    "- No afirmes el estado de la causa como definitivo: verifica siempre en el portal antes de actuar.",
    "- No inventes ROL/RIT/RUC/litigantes que no aparezcan explícitamente arriba.",
    "",
  );
  return lines.join("\n");
}

function okCausaSearch(
  response: CausaPjudSearchResponse,
  formato: "markdown" | "json",
) {
  const text =
    formato === "json"
      ? formatResultsJson(response)
      : formatCausaSearchMarkdown(response);
  return { content: [{ type: "text" as const, text }] };
}

function failCausa(prefix: string, error: unknown) {
  if (error instanceof PjudCausasSolverBudgetError) {
    return okText(
      [`${prefix}: presupuesto diario de CAPTCHA agotado.`, error.message].join(
        "\n",
      ),
    );
  }
  if (error instanceof PjudCausasCaptchaError) {
    return okText(
      [
        `${prefix}: no se pudo resolver el CAPTCHA de PJUD.`,
        error.message,
        "Reintenta en unos minutos; si persiste, verifica manualmente en el portal.",
      ].join("\n"),
    );
  }
  if (error instanceof PjudCausasTimeoutError) {
    return okText(
      [
        `${prefix}: timeout consultando Oficina Judicial Virtual.`,
        error.message,
      ].join("\n"),
    );
  }
  if (error instanceof PjudCausasNoResultsError) {
    return okText([`${prefix}: ${error.message}`].join("\n"));
  }
  return fail(
    `${prefix}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/**
 * Registers the PJUD case-tracking tools (buscar_causa_pjud / obtener_causa_pjud).
 *
 * UNOFFICIAL / ToS-risk: these tools drive a headless browser through PJUD's
 * F5/TSPD anti-bot CAPTCHA using a paid solver API. Disabled by default
 * (PJUD_CAUSAS_ENABLED != 1) and degrades to a portal_stub-equivalent
 * response whenever the kill switch is off or no solver is configured — see
 * docs/pjud-casetracking-solution.md.
 */
export function registerCausasTools(server: McpServer): void {
  server.registerTool(
    "buscar_causa_pjud",
    {
      title: "Buscar causa PJUD por RUT o nombre de litigante",
      description:
        "[EXPERIMENTAL/NO OFICIAL] Busca causas en la Consulta Unificada de PJUD (Oficina Judicial Virtual) por RUT o nombre de litigante. Requiere PJUD_CAUSAS_ENABLED=1 y un solver de CAPTCHA configurado; si no, retorna portal_stub. Resultados siempre integrity=candidate (scraping vía workaround de CAPTCHA, NO es una API oficial de PJUD).",
      inputSchema: {
        rut_o_nombre: z.string().min(2),
        tipo_persona: z.enum(["natural", "juridica"]).default("natural"),
        competencia: z.string().optional(),
        limite: z.number().int().min(1).max(20).default(8),
        formato: formatoSchema,
      },
    },
    async ({ rut_o_nombre, tipo_persona, competencia, limite, formato }) => {
      try {
        return okCausaSearch(
          await timedSearch("buscar_causa_pjud", (signal) =>
            buscarCausaPjud(rut_o_nombre, tipo_persona, limite, {
              competencia,
              signal,
            }),
          ),
          formato,
        );
      } catch (error) {
        return failCausa("Error al buscar causa PJUD", error);
      }
    },
  );

  server.registerTool(
    "obtener_causa_pjud",
    {
      title: "Obtener causa PJUD por ROL/RIT/RUC",
      description:
        "[EXPERIMENTAL/NO OFICIAL] Obtiene el detalle de una causa (estado, litigantes, movimientos) en la Consulta Unificada de PJUD por ROL/RIT/RUC. Requiere PJUD_CAUSAS_ENABLED=1 y un solver de CAPTCHA configurado; si no, retorna portal_stub. Resultado siempre integrity=candidate.",
      inputSchema: {
        rol_o_rit: z.string().min(1),
        tribunal: z.string().optional(),
        formato: formatoSchema,
      },
    },
    async ({ rol_o_rit, tribunal, formato }) => {
      try {
        return okCausaSearch(
          await timedSearch("obtener_causa_pjud", (signal) =>
            obtenerCausaPjud(rol_o_rit, { tribunal, signal }),
          ),
          formato,
        );
      } catch (error) {
        return failCausa("Error al obtener causa PJUD", error);
      }
    },
  );
}
