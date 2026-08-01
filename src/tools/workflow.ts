import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { investigarTema } from "../sources/research.js";
import {
  compararActuaciones,
  contextoDesdeCausa,
  formatAnexoCitas,
  type CitaAnexoItem,
} from "../studyExtras.js";
import {
  ESCRITO_TIPOS,
  MINUTA_TIPOS,
  minutaCliente,
  plantillaEscrito,
} from "../templates.js";
import { FLUJO_MODOS, planFlujoEstudio, shouldRunPack } from "../workflow.js";
import { fail, okText, timed } from "./helpers.js";

const citaAnexoSchema = z.object({
  tipo: z.enum(["norma", "jurisprudencia", "dictamen", "doctrina"]),
  citation: z.string().min(3),
  url: z.string().min(8),
  integrity: z.enum(["verified", "candidate", "portal_stub"]),
  extracto: z.string().optional(),
  rol: z.string().optional(),
  id_norma: z.string().optional(),
  articulo: z.string().optional(),
});

export function registerWorkflowTools(server: McpServer): void {
  server.registerTool(
    "flujo_estudio",
    {
      title: "Router de flujo de trabajo para abogados",
      description:
        "Devuelve el plan de tools MCP según el entregable (memo, escrito, seguimiento_causa, cita_rapida, consulta). No consulta fuentes externas. Para plan + pack usa `asesorar`.",
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

  server.registerTool(
    "asesorar",
    {
      title: "Asesorar: plan de flujo + pack inicial",
      description:
        "Orquesta el flujo de estudio: devuelve el plan (`flujo_estudio`) y, por defecto en modos memo/escrito/consulta, ejecuta `investigar_tema` como primer paso. Luego el asistente debe bajar a texto verified y redactar el entregable.",
      inputSchema: {
        modo: z.enum(FLUJO_MODOS),
        consulta: z.string().min(2),
        rol: z.string().optional(),
        rit: z.string().optional(),
        numero_dictamen: z.string().optional(),
        ejecutar_pack: z
          .boolean()
          .default(true)
          .describe(
            "Si true (default), corre investigar_tema en modos memo/escrito/consulta",
          ),
        limite_por_fuente: z.number().int().min(1).max(8).default(2),
      },
    },
    async ({
      modo,
      consulta,
      rol,
      rit,
      numero_dictamen,
      ejecutar_pack,
      limite_por_fuente,
    }) => {
      try {
        const plan = planFlujoEstudio({
          modo,
          consulta,
          rol,
          rit,
          numero_dictamen,
        });
        const runPack = ejecutar_pack && shouldRunPack(modo);
        if (!runPack) {
          return okText(
            [
              plan,
              "",
              "## Pack de investigación",
              modo === "seguimiento_causa"
                ? "_Omitido: usa `obtener_causa_pjud` / `buscar_causa_pjud` y luego `minuta_cliente`._"
                : modo === "cita_rapida"
                  ? "_Omitido: ve directo a `citar_texto_legal` / `pegar_fallo_pjud` / `citar_dictamen_pegado`._"
                  : "_Pack no ejecutado (`ejecutar_pack=false`)._",
            ].join("\n"),
          );
        }

        const pack = await timed("asesorar.investigar_tema", () =>
          investigarTema(consulta, limite_por_fuente),
        );
        return okText(
          [
            plan,
            "",
            "---",
            "",
            "## Pack de investigación (primer paso ejecutado)",
            "",
            pack,
            "",
            "### Continuación obligatoria",
            "- Baja a texto oficial (`citar_texto_legal` / `obtener_articulo` / `obtener_fallo_tc`).",
            "- PJUD: `indice_considerandos` o `pegar_fallo_pjud` con texto pegado.",
            "- Redacta el entregable del modo; usa `plantilla_escrito` o `minuta_cliente` si ayuda.",
          ].join("\n"),
        );
      } catch (error) {
        return fail(
          `Error asesorar: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "plantilla_escrito",
    {
      title: "Plantilla estructural de escrito",
      description:
        "Devuelve el esqueleto de un escrito chileno (demanda laboral, protección, ejecutivo, contencioso-administrativo, nulidad penal, familia o genérico) con tools sugeridas. No inventa hechos ni citas.",
      inputSchema: {
        tipo: z.enum(ESCRITO_TIPOS),
        materia: z.string().optional(),
        hechos: z.string().optional(),
      },
    },
    async ({ tipo, materia, hechos }) =>
      okText(plantillaEscrito({ tipo, materia, hechos })),
  );

  server.registerTool(
    "minuta_cliente",
    {
      title: "Minuta / aviso al cliente",
      description:
        "Genera la estructura de un mensaje al cliente (actualización de causa, resumen de asesoría o solicitud de antecedentes) a partir del contexto aportado. No inventa movimientos ni resoluciones.",
      inputSchema: {
        tipo: z.enum(MINUTA_TIPOS),
        contexto: z
          .string()
          .min(10)
          .describe(
            "Hechos, movimientos PJUD pegados o hallazgos ya verificados",
          ),
        rol_o_rit: z.string().optional(),
        caratulado: z.string().optional(),
        destinatario: z.string().optional(),
        tono: z.enum(["formal", "claro"]).default("claro"),
      },
    },
    async ({ tipo, contexto, rol_o_rit, caratulado, destinatario, tono }) =>
      okText(
        minutaCliente({
          tipo,
          contexto,
          rol_o_rit,
          caratulado,
          destinatario,
          tono,
        }),
      ),
  );

  server.registerTool(
    "anexo_citas",
    {
      title: "Anexo de citas del escrito",
      description:
        "Formatea un anexo/bibliografía separando citas verified vs por verificar. Solo pasa citas ya obtenidas por tools o texto pegado (no inventes).",
      inputSchema: {
        titulo: z.string().optional(),
        citas: z.array(citaAnexoSchema).min(1).max(40),
      },
    },
    async ({ titulo, citas }) => {
      try {
        return okText(
          formatAnexoCitas({
            titulo,
            citas: citas as CitaAnexoItem[],
          }),
        );
      } catch (error) {
        return fail(
          `Error anexo_citas: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "comparar_actuaciones",
    {
      title: "Comparar actuaciones de una causa",
      description:
        "Diff entre dos listas de movimientos (una por línea): nuevas / desaparecidas / sin cambio. Útil antes de `minuta_cliente`. Integrity candidate.",
      inputSchema: {
        anteriores: z
          .string()
          .describe("Snapshot anterior de actuaciones (una por línea)"),
        actuales: z
          .string()
          .describe("Snapshot actual de actuaciones (una por línea)"),
        rol_o_rit: z.string().optional(),
        caratulado: z.string().optional(),
      },
    },
    async ({ anteriores, actuales, rol_o_rit, caratulado }) => {
      try {
        return okText(
          compararActuaciones({
            anteriores,
            actuales,
            rol_o_rit,
            caratulado,
          }),
        );
      } catch (error) {
        return fail(
          `Error comparar_actuaciones: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "aviso_desde_causa",
    {
      title: "Aviso al cliente desde datos de causa",
      description:
        "Arma el contexto de una causa (campos o movimientos pegados) y devuelve la estructura `minuta_cliente` de actualización. No consulta PJUD sola; usa datos aportados o el output de obtener_causa_pjud.",
      inputSchema: {
        tribunal: z.string().optional(),
        rol_o_rit: z.string().optional(),
        caratulado: z.string().optional(),
        estado: z.string().optional(),
        litigantes: z.array(z.string()).optional(),
        ultima_actuacion: z.string().optional(),
        movimientos: z
          .string()
          .optional()
          .describe("Movimientos, uno por línea"),
        url: z.string().optional(),
        notas: z.string().optional(),
        destinatario: z.string().optional(),
        tono: z.enum(["formal", "claro"]).default("claro"),
      },
    },
    async ({
      tribunal,
      rol_o_rit,
      caratulado,
      estado,
      litigantes,
      ultima_actuacion,
      movimientos,
      url,
      notas,
      destinatario,
      tono,
    }) => {
      try {
        const contexto = contextoDesdeCausa({
          tribunal,
          rol_o_rit,
          caratulado,
          estado,
          litigantes,
          ultima_actuacion,
          movimientos,
          url,
          notas,
        });
        return okText(
          [
            minutaCliente({
              tipo: "actualizacion_causa",
              contexto,
              rol_o_rit,
              caratulado,
              destinatario,
              tono,
            }),
            "",
            "### Recordatorio",
            "- Datos de causa = `candidate`. Verifica en OJV antes de enviar.",
            "- Si tienes snapshot previo: `comparar_actuaciones` para destacar solo lo nuevo.",
          ].join("\n"),
        );
      } catch (error) {
        return fail(
          `Error aviso_desde_causa: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
