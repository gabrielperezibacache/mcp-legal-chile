#!/usr/bin/env node
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authorizeRequest, authEnabled, quotaSnapshot } from "./auth.js";
import { HOT_IDS_FOR_WARMUP } from "./catalog.js";
import { logger, newRequestId } from "./logger.js";
import { metrics } from "./metrics.js";
import { createServer, VERSION } from "./server.js";
import { parseNormaTexto } from "./sources/normaTexto.js";
import { upstreamStatus } from "./upstream.js";
import rateLimit from "express-rate-limit";
import cors from "cors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const PUBLIC_DIR = path.resolve(__dirname, "../public");

function allowedHosts(): string[] | undefined {
  const configured = process.env.ALLOWED_HOSTS?.split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const renderHost = process.env.RENDER_EXTERNAL_HOSTNAME?.trim();
  const fromPublic = (() => {
    const base = process.env.PUBLIC_BASE_URL;
    if (!base) return undefined;
    try {
      return new URL(base).hostname;
    } catch {
      return undefined;
    }
  })();
  const hosts = [
    ...(configured ?? []),
    ...(renderHost ? [renderHost] : []),
    ...(fromPublic ? [fromPublic] : []),
    "localhost",
    "127.0.0.1",
  ];
  const unique = [...new Set(hosts)];
  if (HOST === "0.0.0.0" || HOST === "::") {
    return unique.length > 2 ? unique : undefined;
  }
  return unique;
}

const app = createMcpExpressApp({
  host: HOST,
  allowedHosts: allowedHosts(),
});

// Render (and most PaaS) terminate TLS at a reverse proxy in front of the app;
// trust its X-Forwarded-For so req.ip / rate limiting see the real client IP.
app.set("trust proxy", 1);
// Never leak stack traces / file paths in error responses, even if NODE_ENV
// isn't explicitly set to "production" by the hosting platform.
app.set("env", "production");
// Don't advertise the framework/version to probing clients.
app.disable("x-powered-by");

// Open, keyless MCP endpoint by design (see auth.ts): browser-based MCP
// clients need explicit CORS headers, not just same-origin fetches, or their
// preflight OPTIONS requests fail before authorizeRequest ever runs.
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id"],
    exposedHeaders: ["Mcp-Session-Id"],
  }),
);

app.use(express.static(PUBLIC_DIR));

/**
 * Coarse IP-based abuse guard in front of /mcp, independent of the per-API-key
 * daily quota in auth.ts (which only applies when MCP_API_KEYS is set). This
 * protects the free, open-access default deployment from a single client
 * hammering the process and starving other users / upstream circuits.
 */
const mcpRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    jsonrpc: "2.0",
    error: { code: -32000, message: "Too many requests. Retry in ~1 minute." },
    id: null,
  },
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "mcp-legal-chile", version: VERSION });
});

app.get("/metrics", async (_req, res) => {
  res.json({
    ...metrics.snapshot(VERSION),
    upstream: upstreamStatus(),
    quotas: await quotaSnapshot(),
  });
});

/** Keep-alive / warmup ping for free→starter cron. */
app.get("/warmup", async (_req, res) => {
  const ids = HOT_IDS_FOR_WARMUP.slice(0, 3);
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const id of ids) {
    try {
      await parseNormaTexto(id);
      results.push({ id, ok: true });
    } catch (error) {
      results.push({
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  res.json({ ok: true, warmed: results });
});

app.get("/.well-known/mcp.json", (_req, res) => {
  const renderUrl = process.env.RENDER_EXTERNAL_URL?.replace(/\/$/, "");
  const base =
    process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ||
    renderUrl ||
    `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
  res.json({
    name: "MCP Legal Chile",
    description:
      "Derecho chileno para asistentes de IA: legislación con texto LeyChile, jurisprudencia/dictámenes link-first, doctrina y packs de investigación.",
    url: `${base}/mcp`,
    version: VERSION,
    authRequired: authEnabled(),
  });
});

async function handleMcp(
  req: express.Request,
  res: express.Response,
): Promise<void> {
  metrics.markRequest();
  const requestId = newRequestId();
  const startedAt = Date.now();
  res.setHeader("X-Request-Id", requestId);

  const method = typeof req.body?.method === "string" ? req.body.method : "";
  const toolName =
    method === "tools/call" && typeof req.body?.params?.name === "string"
      ? req.body.params.name
      : undefined;
  const expensive =
    toolName != null &&
    /obtener_texto_norma|obtener_articulo|obtener_inciso|investigar_tema/.test(
      toolName,
    );

  logger.info("mcp_request_start", {
    requestId,
    method,
    tool: toolName,
    ip: req.ip,
  });

  const auth = await authorizeRequest(
    req.header("authorization") ?? undefined,
    expensive ? "expensive" : "cheap",
  );
  if (!auth.ok) {
    logger.warn("mcp_request_unauthorized", {
      requestId,
      status: auth.status,
    });
    res.status(auth.status).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: auth.message },
      id: req.body?.id ?? null,
    });
    return;
  }

  const server = createServer();
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      void transport.close();
      void server.close();
      logger.info("mcp_request_end", {
        requestId,
        tool: toolName,
        durationMs: Date.now() - startedAt,
        status: res.statusCode,
      });
    });
  } catch (error) {
    logger.error("mcp_request_error", {
      requestId,
      tool: toolName,
      error: error instanceof Error ? error.message : String(error),
    });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}

app.post("/mcp", mcpRateLimiter, (req, res) => {
  void handleMcp(req, res);
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. Use POST." },
    id: null,
  });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

// Final error handler: replaces Express's default HTML error page (which, in
// dev-style environments, echoes the raw error message/stack) with a plain
// JSON-RPC-shaped response that never leaks internals like file paths.
app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const status =
      typeof (err as { status?: number; statusCode?: number })?.status ===
      "number"
        ? (err as { status: number }).status
        : typeof (err as { statusCode?: number })?.statusCode === "number"
          ? (err as { statusCode: number }).statusCode
          : 400;
    if (req.path === "/mcp") {
      res.status(status).json({
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid request body." },
        id: null,
      });
      return;
    }
    res.status(status).json({ ok: false, error: "Invalid request." });
  },
);

async function warmupHotNormas(): Promise<void> {
  if (process.env.WARMUP_ON_BOOT === "0") return;
  const ids = HOT_IDS_FOR_WARMUP.slice(0, 4);
  logger.info("warmup_start", { ids });
  for (const id of ids) {
    try {
      await parseNormaTexto(id);
      logger.info("warmup_ok", { id });
    } catch (error) {
      logger.warn("warmup_fail", {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

const httpServer = app.listen(PORT, HOST, (error?: Error) => {
  if (error) {
    logger.error("server_start_failed", { error: error.message });
    process.exit(1);
  }
  logger.info("server_started", {
    version: VERSION,
    host: HOST,
    port: PORT,
    mcpEndpoint: `http://${HOST}:${PORT}/mcp`,
  });
  void warmupHotNormas();
});

// Guard against slow-client / slowloris-style connections holding sockets
// open indefinitely. Node defaults (0 = unlimited) are unsafe for a public
// endpoint; keep generous headroom above SEARCH_TOOL_TIMEOUT_MS/PACK_TOTAL_MS
// so legitimate long tool calls still complete.
httpServer.requestTimeout = Number(
  process.env.HTTP_REQUEST_TIMEOUT_MS ?? 60_000,
);
httpServer.headersTimeout = Number(
  process.env.HTTP_HEADERS_TIMEOUT_MS ?? 65_000,
);
httpServer.keepAliveTimeout = Number(
  process.env.HTTP_KEEPALIVE_TIMEOUT_MS ?? 61_000,
);

/** Graceful shutdown: stop accepting new connections, let in-flight requests finish. */
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutdown_start", { signal });
  const forceExitTimer = setTimeout(() => {
    logger.error("shutdown_timeout_force_exit");
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();
  httpServer.close((err) => {
    if (err) {
      logger.error("shutdown_error", { error: err.message });
      process.exit(1);
    }
    logger.info("shutdown_clean");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Last-resort safety nets: log and keep the process alive rather than letting
// one unexpected upstream/parsing error crash the whole server (Render would
// then cycle restarts, dropping every in-flight request each time).
process.on("uncaughtException", (error) => {
  logger.error("uncaught_exception", {
    error: error.message,
    stack: error.stack,
  });
});
process.on("unhandledRejection", (reason) => {
  logger.error("unhandled_rejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});
