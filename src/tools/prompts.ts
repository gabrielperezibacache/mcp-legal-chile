import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "consulta_juridica_chile",
    {
      title: "Consulta juridica chilena con fuentes",
      description: "Responde solo con tools MCP Legal Chile.",
      argsSchema: { pregunta: z.string() },
    },
    ({ pregunta }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Usa preferentemente investigar_tema, luego obtener_articulo/obtener_inciso segun haga falta.",
              `Pregunta: ${pregunta}`,
              "Cita URL siempre. Indica integrity/evidencia. Si link_only o portal_stub, no afirmes contenido.",
              "Prohibido inventar ROL, dictamenes, articulos o considerandos no devueltos por las tools.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "citar_articulo_ley",
    {
      title: "Citar articulo de ley chilena",
      description: "Obtiene y formatea un articulo oficial.",
      argsSchema: {
        id_norma: z.string(),
        articulo: z.string(),
      },
    },
    ({ id_norma, articulo }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Usa obtener_articulo (id_norma=${id_norma}, articulo=${articulo}) y formatear_cita. Presenta texto oficial + cita + URL.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "memo_asesoria",
    {
      title: "Memo de asesoria (IRAC)",
      description: "Estructura IRAC con citas obligatorias de tools.",
      argsSchema: { tema: z.string() },
    },
    ({ tema }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Redacta un memo IRAC sobre: ${tema}`,
              "1) investigar_tema",
              "2) obtener_articulo de normas clave",
              "3) Hechos / Issue / Rule (con citas URL) / Application / Conclusion",
              "4) Seccion 'Que falta verificar' si hay link_only",
              "Aclara que no es asesoria formal.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "checklist_recurso_proteccion",
    {
      title: "Checklist recurso de proteccion",
      description: "Pasos y tools a invocar antes de redactar.",
      argsSchema: { hechos: z.string() },
    },
    ({ hechos }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Hechos preliminares: ${hechos}`,
              "Checklist: (1) art. 20 CPR via obtener_articulo idNorma 242302",
              "(2) garantias involucradas art. 19",
              "(3) buscar_jurisprudencia / buscar_tc; ROL TC -> obtener_fallo_tc / citar_jurisprudencia; PJUD -> pegar texto en citar_jurisprudencia",
              "(4) lista de pruebas y plazos — sin inventar jurisprudencia",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "checklist_demanda_laboral",
    {
      title: "Checklist demanda laboral",
      description: "Normas CT + jurisprudencia a verificar.",
      argsSchema: { materia: z.string() },
    },
    ({ materia }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Materia laboral: ${materia}`,
              "1) buscar_legislacion Codigo del Trabajo / obtener_articulo",
              "2) buscar_jurisprudencia con filtros",
              "3) Listar pretensiones y normas citables con URL",
              "No inventes ROL ni montos.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "lista_prueba_normativa",
    {
      title: "Lista de prueba normativa",
      description: "Que articulos pedir antes de redactar.",
      argsSchema: { tema: z.string() },
    },
    ({ tema }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Para redactar sobre "${tema}", usa investigar_tema y produce una checklist de idNorma+articulo a obtener_articulo antes de escribir.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "citar_doctrina_y_norma",
    {
      title: "Citar doctrina + texto legal",
      description:
        "Combina cita doctrinal formal con blockquote del articulo oficial de LeyChile.",
      argsSchema: {
        tema: z.string(),
        id_norma: z.string().optional(),
        articulo: z.string().optional(),
      },
    },
    ({ tema, id_norma, articulo }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Tema: ${tema}`,
              "1) buscar_doctrina y, si hay DOI, obtener_doctrina",
              id_norma && articulo
                ? `2) citar_texto_legal id_norma=${id_norma} articulo=${articulo}`
                : "2) buscar_legislacion y luego citar_texto_legal del articulo mas pertinente",
              "3) Entregar: (A) citas doctrinales Chile/APA (B) blockquote del texto legal (C) parrafo que las articule sin inventar.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
