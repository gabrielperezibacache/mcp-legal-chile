import { z } from "zod";
import { runWithDeadline } from "../deadline.js";
import { formatSearchMarkdown } from "../format.js";
import { sealSearchResponse } from "../integrity.js";
import { metrics } from "../metrics.js";
import type { SearchResponse } from "../types.js";
import { formatResultsJson } from "../util.js";
import {
  ArticleNotFoundError,
  FragmentNotFoundError,
  LeyChileRateLimitError,
  LeyChileXmlError,
  UnsupportedNormaStructureError,
} from "../sources/normaTexto.js";
import { CircuitOpenError } from "../upstream.js";

/** Must exceed TC keyword latency (often 6–14s) without cascading into slow web scrape. */
export const SEARCH_TOOL_TIMEOUT_MS = Number(
  process.env.SEARCH_TOOL_TIMEOUT_MS ?? 22_000,
);

export const latamPaisSchema = z
  .enum(["PE", "BR", "AR", "MX", "CO"])
  .describe("País LATAM: PE, BR, AR, MX, CO");

export const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(20)
  .default(8)
  .describe("Cantidad máxima de resultados (1-20)");

export const formatoSchema = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("Formato de salida: markdown (recomendado para citas) o json");

export function okSearch(data: SearchResponse, formato: "markdown" | "json") {
  const sealed = sealSearchResponse(data);
  const text =
    formato === "json"
      ? formatResultsJson(sealed)
      : formatSearchMarkdown(sealed);
  return { content: [{ type: "text" as const, text }] };
}

export function okText(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

export function formatLegalExtractionError(
  error: unknown,
  idNorma: string,
): string {
  const code = idNorma.replace(/\D/g, "");
  const official = `https://www.bcn.cl/leychile/navegar?idNorma=${code}`;
  const xml = `https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=${code}`;
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof FragmentNotFoundError) {
    return [
      "Fragmento (inciso/literal) no encontrado en el parseo del artículo.",
      `Detalle: ${message}`,
      `Fuente oficial: ${official}`,
      "El artículo existe; revisa la numeración del inciso/literal o usa obtener_texto_norma modo=articulo / modo=indice. No inventes el fragmento.",
    ].join("\n");
  }

  const title =
    error instanceof ArticleNotFoundError
      ? "Artículo no encontrado."
      : error instanceof UnsupportedNormaStructureError
        ? "Formato XML no soportado por el parser."
        : error instanceof LeyChileXmlError
          ? "XML LeyChile inválido o no disponible."
          : error instanceof LeyChileRateLimitError
            ? "LeyChile rate-limit temporal (HTTP 429)."
            : error instanceof CircuitOpenError
              ? "Circuito LeyChile temporalmente abierto (protección de rate-limit)."
              : "No se pudo extraer texto oficial desde LeyChile.";

  return [
    title,
    `Detalle: ${message}`,
    `Fuente oficial: ${official}`,
    `XML oficial: ${xml}`,
    "No inventes el contenido: verifica manualmente o usa obtener_texto_norma modo=indice (o modo=cuerpo) para ver artículos detectados.",
  ].join("\n");
}

/**
 * Soft degradations (429 / circuit open): useful markdown without isError so
 * MCP clients (e.g. Hermes) do not trip a global "unreachable" cooldown.
 */
export function legalExtractionFailure(error: unknown, idNorma: string) {
  const code = idNorma.replace(/\D/g, "");
  const official = `https://www.bcn.cl/leychile/navegar?idNorma=${code}`;
  if (error instanceof LeyChileRateLimitError) {
    const sec = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
    return okText(
      [
        "LeyChile está limitando temporalmente las solicitudes (HTTP 429).",
        `Reintenta en ~${sec}s. Mientras tanto usa la URL oficial (no inventes el texto).`,
        `Fuente oficial: ${official}`,
        `XML: https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=${code}`,
        `Detalle: ${error.message}`,
      ].join("\n"),
    );
  }
  if (error instanceof CircuitOpenError) {
    const sec = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
    return okText(
      [
        `El circuito de ${error.host} está temporalmente abierto tras fallos upstream.`,
        `Reintenta en ~${sec}s. Usa la URL oficial mientras tanto (no inventes el texto).`,
        `Fuente oficial: ${official}`,
        `XML: https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=${code}`,
        `Detalle: ${error.message}`,
      ].join("\n"),
    );
  }
  return fail(formatLegalExtractionError(error, idNorma));
}

export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  metrics.markToolCall();
  return metrics.time("tool", () => metrics.time(name, fn));
}

export async function timedSearch<T>(
  name: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return timed(name, () => runWithDeadline(name, SEARCH_TOOL_TIMEOUT_MS, fn));
}
