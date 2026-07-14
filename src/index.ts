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

const app = createMcpExpressApp({
  host: HOST,
  allowedHosts: process.env.ALLOWED_HOSTS?.split(",")
    .map((h) => h.trim())
    .filter(Boolean),
});

app.use(express.static(PUBLIC_DIR));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "mcp-legal-chile", version: "1.0.0" });
});

app.get("/.well-known/mcp.json", (_req, res) => {
  const base =
    process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ||
    `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
  res.json({
    name: "MCP Legal Chile",
    description:
      "Derecho chileno para asistentes de IA: legislación, jurisprudencia, doctrina y dictámenes con citas verificables.",
    url: `${base}/mcp`,
    version: "1.0.0",
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
