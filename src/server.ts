import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../package.json" with { type: "json" };
import { registerDictamenesTools } from "./tools/dictamenes.js";
import { registerDoctrinaTools } from "./tools/doctrina.js";
import { registerJurisprudenciaTools } from "./tools/jurisprudencia.js";
import { registerLegislacionTools } from "./tools/legislacion.js";
import { registerMetaTools } from "./tools/meta.js";
import { registerPrompts } from "./tools/prompts.js";

export const VERSION: string = pkg.version;

/**
 * Builds a fresh McpServer instance with every tool and prompt registered.
 * A new instance is created per HTTP request (see index.ts) because the
 * Streamable HTTP transport binds 1:1 to a server instance; tool
 * implementations themselves are stateless singletons imported from
 * ./tools/*, so this is cheap (no per-request I/O).
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "mcp-legal-chile",
    version: VERSION,
  });

  registerLegislacionTools(server);
  registerJurisprudenciaTools(server);
  registerDoctrinaTools(server);
  registerDictamenesTools(server);
  registerMetaTools(server, VERSION);
  registerPrompts(server);

  return server;
}
