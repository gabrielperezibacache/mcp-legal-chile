#!/usr/bin/env node
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authorizeRequest, authEnabled, quotaSnapshot } from "./auth.js";
import { HOT_IDS_FOR_WARMUP } from "./catalog.js";
import { metrics } from "./metrics.js";
import { createServer, VERSION } from "./server.js";
import { parseNormaTexto } from "./sources/normaTexto.js";
import { upstreamStatus } from "./upstream.js";

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

app.use(express.static(PUBLIC_DIR));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "mcp-legal-chile", version: VERSION });
});

app.get("/metrics", (_req, res) => {
  res.json({
    ...metrics.snapshot(),
    upstream: upstreamStatus(),
    quotas: quotaSnapshot(),
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

  const method =
    typeof req.body?.method === "string" ? req.body.method : "";
  const expensive =
    method === "tools/call" &&
    typeof req.body?.params?.name === "string" &&
    /obtener_texto_norma|obtener_articulo|obtener_inciso|investigar_tema/.test(
      req.body.params.name,
    );

  const auth = authorizeRequest(
    req.header("authorization") ?? undefined,
    expensive ? "expensive" : "cheap",
  );
  if (!auth.ok) {
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
    });
  } catch (error) {
    console.error("Error MCP:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}

app.post("/mcp", (req, res) => {
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

async function warmupHotNormas(): Promise<void> {
  if (process.env.WARMUP_ON_BOOT === "0") return;
  const ids = HOT_IDS_FOR_WARMUP.slice(0, 4);
  console.error(`[warmup] prefetching ${ids.join(", ")}`);
  for (const id of ids) {
    try {
      await parseNormaTexto(id);
      console.error(`[warmup] ok ${id}`);
    } catch (error) {
      console.error(
        `[warmup] fail ${id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

app.listen(PORT, HOST, (error?: Error) => {
  if (error) {
    console.error("No se pudo iniciar el servidor:", error);
    process.exit(1);
  }
  console.error(`MCP Legal Chile v${VERSION} en http://${HOST}:${PORT}`);
  console.error(`Endpoint MCP: http://${HOST}:${PORT}/mcp`);
  void warmupHotNormas();
});
