/**
 * Minimal structured (JSON-lines) logger for stderr, consumed by Render's log
 * aggregator. Keeps output greppable/parseable without pulling in a logging
 * dependency for a single-process MCP server.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

const LOG_LEVEL = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const MIN_LEVEL = LEVEL_ORDER[(LOG_LEVEL as LogLevel) ?? "info"] ?? 20;

/** JSON output is easier to query in Render/other log drains; plain text is
 * friendlier for local `npm run dev`. */
const JSON_LOGS =
  process.env.LOG_FORMAT === "json" || Boolean(process.env.RENDER);

function write(level: LogLevel, msg: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < MIN_LEVEL) return;
  if (JSON_LOGS) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        msg,
        ...fields,
      }),
    );
    return;
  }
  const suffix =
    fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : "";
  console.error(`[${level}] ${msg}${suffix}`);
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};

/** Short, log-friendly request id (not cryptographically sensitive). */
export function newRequestId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
