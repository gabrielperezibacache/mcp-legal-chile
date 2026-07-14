#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Legal Chile (stdio) listo");
}

main().catch((error) => {
  console.error("Error fatal:", error);
  process.exit(1);
});
