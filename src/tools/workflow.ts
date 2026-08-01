import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ANTECEDENTE_MATERIAS,
  FLUJO_MODOS_CON_AUTO,
  formatCatalogoFlujos,
  inferTipoEscrito,
  listaAntecedentes,
  listaPruebaNormativa,
  mapEscritoToAntecedentes,
  resolveFlujoModo,
} from "../catalogFlujo.js";
import { investigarTema } from "../sources/research.js";
import {
  compararActuaciones,
  contextoDesdeCausa,
  formatAnexoCitas,
  type CitaAnexoItem,
} from "../studyExtras.js";
import {
  ESTADOS_FLUJO,
  guiaDiaTipico,
  siguientePaso,
} from "../siguientePaso.js";
import {
  ESCRITO_TIPOS,
  MINUTA_TIPOS,
  borradorMensajeCliente,
  minutaCliente,
  plantillaEscrito,
} from "../templates.js";
import { planFlujoEstudio, shouldRunPack } from "../workflow.js";
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
    "catalogo_flujos",
    {
      title: "Catálogo de flujos de estudio",
      description:
        "Lista los flujos recomendados (memo, escrito, seguimiento, citas PJUD/CGR, antecedentes) con tools y resources. Útil cuando el cliente MCP no muestra prompts.",
      inputSchema: {},
    },
    async () => okText(formatCatalogoFlujos()),
  );

  server.registerTool(
    "siguiente_paso",
    {
      title: "Sugerir siguiente tool del flujo",
      description:
        "Dado el estado actual del trabajo (pack_listo, causa_obtenida, escrito_estructurado, etc.), indica la siguiente tool MCP a llamar. No consulta fuentes externas.",
      inputSchema: {
        estado: z.enum(ESTADOS_FLUJO),
        consulta: z.string().optional(),
      },
    },
    async ({ estado, consulta }) => okText(siguientePaso({ estado, consulta })),
  );

  server.registerTool(
    "lista_antecedentes",
    {
      title: "Lista de antecedentes a pedir al cliente",
      description:
        "Checklist orientativa de documentos/datos a solicitar según materia (laboral, protección, ejecutivo, familia, penal, administrativo, civil, consumidor). No afirma que el cliente ya los tenga.",
      inputSchema: {
        materia: z.enum(ANTECEDENTE_MATERIAS),
        hechos: z.string().optional(),
        urgencia: z.string().optional(),
      },
    },
    async ({ materia, hechos, urgencia }) =>
      okText(listaAntecedentes({ materia, hechos, urgencia })),
  );

  server.registerTool(
    "lista_prueba_normativa",
    {
      title: "Lista de prueba normativa (artículos a obtener)",
      description:
        "Sugiere idNorma + artículos a pedir con `obtener_articulo` antes de redactar, según el tema (hot catalog + artículos típicos). No afirma el texto de los artículos.",
      inputSchema: {
        tema: z.string().min(2),
        tipo_escrito: z.enum(ESCRITO_TIPOS).optional(),
      },
    },
    async ({ tema, tipo_escrito }) =>
      okText(listaPruebaNormativa({ tema, tipo_escrito })),
  );

  server.registerTool(
    "flujo_estudio",
    {
      title: "Router de flujo de trabajo para abogados",
      description:
        "Devuelve el plan de tools MCP según el entregable. Usa modo `auto` para inferir desde la consulta. Para plan + pack usa `asesorar`.",
      inputSchema: {
        modo: z
          .enum(FLUJO_MODOS_CON_AUTO)
          .default("auto")
          .describe("Tipo de entregable o `auto`"),
        consulta: z.string().min(2),
        rol: z.string().optional().describe("ROL de causa o fallo, si aplica"),
        rit: z.string().optional().describe("RIT de causa, si aplica"),
        numero_dictamen: z.string().optional(),
      },
    },
    async ({ modo, consulta, rol, rit, numero_dictamen }) => {
      const resolved = resolveFlujoModo(modo, consulta);
      const plan = planFlujoEstudio({
        modo: resolved.modo,
        consulta,
        rol,
        rit,
        numero_dictamen,
      });
      if (!resolved.inferred) return okText(plan);
      return okText(
        [
          `_Modo inferido automáticamente: \`${resolved.modo}\`._`,
          "",
          plan,
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "asesorar",
    {
      title: "Asesorar: plan de flujo + pack inicial",
      description:
        "Orquesta el flujo de estudio: plan + `investigar_tema` (modos memo/escrito/consulta). `modo=auto` infiere el entregable desde la consulta.",
      inputSchema: {
        modo: z.enum(FLUJO_MODOS_CON_AUTO).default("auto"),
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
        const resolved = resolveFlujoModo(modo, consulta);
        const plan = planFlujoEstudio({
          modo: resolved.modo,
          consulta,
          rol,
          rit,
          numero_dictamen,
        });
        const header = resolved.inferred
          ? `_Modo inferido automáticamente: \`${resolved.modo}\`._\n\n`
          : "";
        const runPack = ejecutar_pack && shouldRunPack(resolved.modo);
        if (!runPack) {
          return okText(
            [
              header + plan,
              "",
              "## Pack de investigación",
              resolved.modo === "seguimiento_causa"
                ? "_Omitido: usa `obtener_causa_pjud` / `buscar_causa_pjud` y luego `minuta_cliente`._"
                : resolved.modo === "cita_rapida"
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
            header + plan,
            "",
            "---",
            "",
            "## Pack de investigación (primer paso ejecutado)",
            "",
            pack,
            "",
            "### Continuación obligatoria",
            "- `lista_prueba_normativa` → `obtener_articulo` / `citar_texto_legal`.",
            "- PJUD: `indice_considerandos` o `pegar_fallo_pjud` con texto pegado.",
            "- Redacta con `plantilla_escrito` / `minuta_cliente` / `anexo_citas`.",
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
    "preparar_entregable",
    {
      title: "Preparar entregable (plan + plantilla + pack)",
      description:
        "Orquesta el inicio de un memo o escrito: plan de flujo, plantilla (si escrito), lista de antecedentes sugerida y, por defecto, pack `investigar_tema`. Luego baja a texto verified y usa `anexo_citas`.",
      inputSchema: {
        modo: z.enum(["memo", "escrito", "auto"]).default("auto"),
        consulta: z.string().min(2),
        tipo_escrito: z.enum(ESCRITO_TIPOS).optional(),
        hechos: z.string().optional(),
        ejecutar_pack: z.boolean().default(true),
        limite_por_fuente: z.number().int().min(1).max(8).default(2),
      },
    },
    async ({
      modo,
      consulta,
      tipo_escrito,
      hechos,
      ejecutar_pack,
      limite_por_fuente,
    }) => {
      try {
        const inferredFlujo = resolveFlujoModo("auto", consulta).modo;
        const flujo: "memo" | "escrito" =
          modo === "auto"
            ? inferredFlujo === "memo"
              ? "memo"
              : "escrito"
            : modo;
        const tipo = tipo_escrito ?? inferTipoEscrito(consulta);
        const tipoAuto = !tipo_escrito;
        const plan = planFlujoEstudio({ modo: flujo, consulta });
        const sections: string[] = [
          `# Preparar entregable — modo \`${flujo}\`${modo === "auto" ? " _(auto)_" : ""}`,
          tipoAuto && flujo === "escrito"
            ? `_Tipo de escrito inferido: \`${tipo}\`._`
            : undefined,
          "",
          plan,
        ].filter((x): x is string => Boolean(x));

        if (flujo === "escrito") {
          sections.push(
            "",
            "---",
            "",
            listaPruebaNormativa({ tema: consulta, tipo_escrito: tipo }),
            "",
            "---",
            "",
            plantillaEscrito({
              tipo,
              materia: consulta,
              hechos,
            }),
          );
        }

        sections.push(
          "",
          "---",
          "",
          listaAntecedentes({
            materia: mapEscritoToAntecedentes(
              flujo === "escrito" ? tipo : undefined,
            ),
            hechos: hechos ?? consulta,
          }),
        );

        if (ejecutar_pack) {
          const pack = await timed("preparar_entregable.investigar_tema", () =>
            investigarTema(consulta, limite_por_fuente),
          );
          sections.push(
            "",
            "---",
            "",
            "## Pack de investigación",
            "",
            pack,
            "",
            "### Continuación",
            "- Extrae texto verified y arma `anexo_citas`.",
            "- Redacta sobre la plantilla; marca `[POR VERIFICAR]` lo no verified.",
            "- Si faltan documentos: `minuta_cliente` tipo `solicitud_antecedentes`.",
          );
        } else {
          sections.push(
            "",
            "_Pack omitido (`ejecutar_pack=false`). Llama `investigar_tema` o `asesorar` cuando quieras fuentes._",
          );
        }

        return okText(sections.join("\n"));
      } catch (error) {
        return fail(
          `Error preparar_entregable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  server.registerTool(
    "plantilla_escrito",
    {
      title: "Plantilla estructural de escrito",
      description:
        "Devuelve el esqueleto de un escrito chileno (demanda laboral, protección, ejecutivo, contencioso-administrativo, nulidad penal, casación, familia o genérico) con tools sugeridas. No inventa hechos ni citas.",
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
        "Genera la estructura de un mensaje al cliente (actualización de causa, resumen de asesoría o solicitud de antecedentes) a partir del contexto aportado. Para un borrador listo para editar usa `borrador_mensaje_cliente`.",
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
    "borrador_mensaje_cliente",
    {
      title: "Borrador de mensaje al cliente",
      description:
        "Redacta un borrador de correo/WhatsApp usando solo el contexto aportado (sin inventar hechos ni efectos jurídicos). Ideal tras `aviso_desde_causa`, `comparar_actuaciones` o `lista_antecedentes`.",
      inputSchema: {
        tipo: z.enum(MINUTA_TIPOS),
        contexto: z.string().min(5),
        rol_o_rit: z.string().optional(),
        caratulado: z.string().optional(),
        destinatario: z.string().optional(),
        tono: z.enum(["formal", "claro"]).default("claro"),
        pedir_antecedentes: z
          .array(z.string())
          .optional()
          .describe("Lista explícita de documentos a pedir"),
      },
    },
    async ({
      tipo,
      contexto,
      rol_o_rit,
      caratulado,
      destinatario,
      tono,
      pedir_antecedentes,
    }) =>
      okText(
        borradorMensajeCliente({
          tipo,
          contexto,
          rol_o_rit,
          caratulado,
          destinatario,
          tono,
          pedir_antecedentes,
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
            "---",
            "",
            borradorMensajeCliente({
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
