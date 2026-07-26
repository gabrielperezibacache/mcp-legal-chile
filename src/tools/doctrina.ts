import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  doctrineToMarkdown,
  formatDoctrineSearchMarkdown,
  obtenerDoctrina,
  searchDoctrina,
  searchDoctrinaLatam,
} from "../sources/index.js";
import { formatResultsJson } from "../util.js";
import {
  fail,
  formatoSchema,
  latamPaisSchema,
  limitSchema,
  okSearch,
  okText,
  timedSearch,
} from "./helpers.js";

export function registerDoctrinaTools(server: McpServer): void {
  server.registerTool(
    "obtener_doctrina",
    {
      title: "Obtener doctrina por SciELO / DOI / OpenAlex",
      description:
        "Recupera una obra doctrinal con cita chilena, APA, abstract y enlaces SciELO/DOI/PDF.",
      inputSchema: {
        doi: z.string().optional(),
        openalex_id: z.string().optional(),
        scielo_pid: z
          .string()
          .optional()
          .describe("PID SciELO, ej. S0718-34372012000300019"),
        collection: z
          .enum(["chl", "scl", "arg", "mex", "per", "col"])
          .optional()
          .describe(
            "Colección ArticleMeta SciELO (chl, scl, arg, mex, per, col)",
          ),
        formato: formatoSchema,
      },
    },
    async ({ doi, openalex_id, scielo_pid, collection, formato }) => {
      try {
        const d = await timedSearch("obtener_doctrina", (signal) =>
          obtenerDoctrina({
            doi,
            openAlexId: openalex_id,
            scieloPid: scielo_pid,
            collection,
            signal,
          }),
        );
        if (formato === "json") return okText(formatResultsJson(d));
        return okText(doctrineToMarkdown(d));
      } catch (error) {
        return fail(
          `Error obtener_doctrina: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "buscar_doctrina",
    {
      title: "Buscar doctrina jurídica chilena",
      description:
        "Doctrina OA gratis: OpenAlex (catálogo revistas CL) + DOAJ + Crossref + enrich ArticleMeta SciELO. Citas Chile/APA.",
      inputSchema: {
        consulta: z.string().min(2),
        limite: limitSchema,
        formato: formatoSchema,
      },
    },
    async ({ consulta, limite, formato }) => {
      try {
        const data = await timedSearch("buscar_doctrina", (signal) =>
          searchDoctrina(consulta, limite, { signal }),
        );
        if (formato === "json") {
          return okSearch(data, "json");
        }
        return okText(
          formatDoctrineSearchMarkdown(data, `Doctrina — ${consulta}`),
        );
      } catch (error) {
        return fail(
          `Error doctrina: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "buscar_doctrina_latam",
    {
      title: "Buscar doctrina jurídica LATAM",
      description:
        "Doctrina LATAM OA: catálogo ISSN + OpenAlex + DOAJ por país (PE/BR/AR/MX/CO).",
      inputSchema: {
        consulta: z.string().min(2),
        pais: latamPaisSchema,
        limite: limitSchema,
        formato: formatoSchema,
      },
    },
    async ({ consulta, pais, limite, formato }) => {
      try {
        const data = await timedSearch("buscar_doctrina_latam", (signal) =>
          searchDoctrinaLatam(consulta, limite, pais, { signal }),
        );
        if (formato === "json") {
          return okSearch(data, "json");
        }
        return okText(
          formatDoctrineSearchMarkdown(data, `Doctrina ${pais} — ${consulta}`),
        );
      } catch (error) {
        return fail(
          `Error doctrina LATAM: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
