import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FLUJO_MODOS, planFlujoEstudio } from "../workflow.js";
import { okText } from "./helpers.js";

export function registerWorkflowTools(server: McpServer): void {
  server.registerTool(
    "flujo_estudio",
    {
      title: "Router de flujo de trabajo para abogados",
      description:
        "Devuelve el plan de tools MCP según el entregable (memo, escrito, seguimiento_causa, cita_rapida, consulta). No consulta fuentes externas: orquesta el siguiente paso del asistente.",
      inputSchema: {
        modo: z.enum(FLUJO_MODOS).describe("Tipo de entregable"),
        consulta: z.string().min(2),
        rol: z.string().optional().describe("ROL de causa o fallo, si aplica"),
        rit: z.string().optional().describe("RIT de causa, si aplica"),
        numero_dictamen: z.string().optional(),
      },
    },
    async ({ modo, consulta, rol, rit, numero_dictamen }) =>
      okText(
        planFlujoEstudio({
          modo,
          consulta,
          rol,
          rit,
          numero_dictamen,
        }),
      ),
  );
}
