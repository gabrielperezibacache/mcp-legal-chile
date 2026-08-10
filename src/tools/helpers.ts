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
import { HttpStatusError } from "../util.js";

/** Must exceed TC keyword latency (often 6–14s) without cascading into slow web scrape. */
export const SEARCH_TOOL_TIMEOUT_MS = Number(
  process.env.SEARCH_TOOL_TIMEOUT_MS ?? 22_000,
);

/** All MCP Legal tools only read public sources or user-provided text. */
export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export async function reportToolProgress(
  extra: unknown,
  progress: number,
  total: number,
  message: string,
): Promise<void> {
  const ctx = extra as
    | {
        _meta?: { progressToken?: string | number };
        sendNotification?: (notification: {
          method: string;
          params: Record<string, unknown>;
        }) => Promise<void>;
      }
    | null
    | undefined;
  const token = ctx?._meta?.progressToken;
  if (token === undefined || !ctx?.sendNotification) return;
  try {
    await ctx.sendNotification({
      method: "notifications/progress",
      params: { progressToken: token, progress, total, message },
    });
  } catch {
    /* Optional MCP progress notifications must never fail a tool. */
  }
}

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

export function okStructured(
  text: string,
  structuredContent: Record<string, unknown>,
) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
  };
}

export function needInput(message: string, sugerencias: string[] = []) {
  return okText(
    [
      "Falta información para continuar (no se inventará).",
      message,
      ...(sugerencias.length
        ? ["", "Sugerencias:", ...sugerencias.map((s) => `- ${s}`)]
        : []),
    ].join("\n"),
  );
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
      "El artículo existe; revisa la numeración del inciso/literal o usa obtener_texto_norma modo=indice / modo=cuerpo. No inventes el fragmento.",
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
 * Soft degradations (429 / circuit open / transient network): useful markdown
 * without isError so MCP clients do not trip a global "unreachable" cooldown.
 */
export function legalExtractionFailure(error: unknown, idNorma: string) {
  const code = idNorma.replace(/\D/g, "");
  const official = `https://www.bcn.cl/leychile/navegar?idNorma=${code}`;
  const xml = `https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=${code}`;
  if (error instanceof LeyChileRateLimitError) {
    const sec = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
    return okText(
      [
        "LeyChile está limitando temporalmente las solicitudes (HTTP 429).",
        `Reintenta en ~${sec}s. Mientras tanto usa la URL oficial (no inventes el texto).`,
        `Fuente oficial: ${official}`,
        `XML: ${xml}`,
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
        `XML: ${xml}`,
        `Detalle: ${error.message}`,
      ].join("\n"),
    );
  }
  if (error instanceof HttpStatusError) {
    const status = error.status;
    const kind =
      status === 401
        ? "HTTP 401 (no autorizado / CloudFront u otro WAF)"
        : status === 403
          ? "HTTP 403 (prohibido / bloqueo de borde)"
          : status === 404
            ? "HTTP 404 (norma o recurso no encontrado)"
            : status === 429
              ? "HTTP 429 (rate limit)"
              : `HTTP ${status}`;
    return okText(
      [
        `LeyChile/BCN respondió ${kind}.`,
        status === 404
          ? "El idNorma probablemente no existe o fue retirado. No inventes el texto."
          : "La fuente oficial bloqueó o no autorizó la descarga automática. Abre la URL manualmente; no inventes el texto.",
        `Fuente oficial: ${official}`,
        `XML: ${xml}`,
        `Detalle: ${error.message}`,
      ].join("\n"),
    );
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (/HTTP\s*401/i.test(msg)) {
    return okText(
      [
        "LeyChile/BCN respondió HTTP 401 (no autorizado / CloudFront u otro WAF).",
        "Abre la URL oficial manualmente; no inventes el texto.",
        `Fuente oficial: ${official}`,
        `XML: ${xml}`,
        `Detalle: ${msg}`,
      ].join("\n"),
    );
  }
  if (/HTTP\s*403/i.test(msg)) {
    return okText(
      [
        "LeyChile/BCN respondió HTTP 403 (prohibido / bloqueo de borde).",
        "Abre la URL oficial manualmente; no inventes el texto.",
        `Fuente oficial: ${official}`,
        `XML: ${xml}`,
        `Detalle: ${msg}`,
      ].join("\n"),
    );
  }
  if (/HTTP\s*404/i.test(msg)) {
    return okText(
      [
        "LeyChile/BCN respondió HTTP 404 (norma o recurso no encontrado).",
        "El idNorma probablemente no existe. No inventes el texto.",
        `Fuente oficial: ${official}`,
        `XML: ${xml}`,
        `Detalle: ${msg}`,
      ].join("\n"),
    );
  }
  if (
    /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|socket|network|aborted|Timeout|HTTP 5\d\d|UND_ERR/i.test(
      msg,
    )
  ) {
    return okText(
      [
        "No se pudo contactar LeyChile/BCN en este momento (error de red o timeout).",
        "No inventes el texto. Abre la URL oficial o reintenta en unos segundos.",
        `Fuente oficial: ${official}`,
        `XML: ${xml}`,
        `Detalle: ${msg}`,
        "Alternativa offline: `DEMO_MODE=1` solo sirve fixtures hot de demo; en producción usa la URL.",
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
