#!/usr/bin/env node
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const PUBLIC_DIR = path.resolve(__dirname, "../public");

/** Hostnames Render and local clients may send (DNS rebinding guard). */
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
  // When binding on all interfaces without an explicit allowlist, skip Host checks.
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
  res.json({ ok: true, service: "mcp-legal-chile", version: "1.1.0" });
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
      "Derecho chileno para asistentes de IA: legislación, jurisprudencia, doctrina y dictámenes con citas verificables.",
    url: `${base}/mcp`,
    version: "1.1.0",
  });
});

async function handleMcp(
  req: express.Request,
  res: express.Response,
): Promise<void> {
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

app.listen(PORT, HOST, (error?: Error) => {
  if (error) {
    console.error("No se pudo iniciar el servidor:", error);
    process.exit(1);
  }
  console.error(`MCP Legal Chile escuchando en http://${HOST}:${PORT}`);
  console.error(`Endpoint MCP: http://${HOST}:${PORT}/mcp`);
});
