import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "flujo_estudio",
    {
      title: "Router de flujo de estudio",
      description:
        "Elige el camino de tools según el entregable (memo, escrito, seguimiento de causa, cita rápida o consulta).",
      argsSchema: {
        modo: z
          .enum([
            "memo",
            "escrito",
            "seguimiento_causa",
            "cita_rapida",
            "consulta",
          ])
          .describe("Tipo de entregable del abogado"),
        consulta: z.string(),
        rol_o_rit: z.string().optional(),
        numero_dictamen: z.string().optional(),
      },
    },
    ({ modo, consulta, rol_o_rit, numero_dictamen }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Modo de trabajo: ${modo}`,
              `Consulta: ${consulta}`,
              rol_o_rit ? `ROL/RIT: ${rol_o_rit}` : undefined,
              numero_dictamen ? `Dictamen: ${numero_dictamen}` : undefined,
              "",
              "1) Prefiere `preparar_entregable` (escrito/memo), `asesorar` (plan+pack) o `catalogo_flujos`.",
              "2) Ejecuta los pasos del plan en orden. No inventes fuentes.",
              "3) Entrega el formato indicado (IRAC, escrito, minuta o cita).",
              "Fallos PJUD → `indice_considerandos` / `pegar_fallo_pjud`. Dictámenes → `citar_dictamen_pegado`.",
            ]
              .filter((x): x is string => Boolean(x))
              .join("\n"),
          },
        },
      ],
    }),
  );

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
    "pegar_fallo_pjud",
    {
      title: "Pegar fallo PJUD y citar",
      description:
        "Guía para citar Corte Suprema / Apelaciones / juzgados con texto pegado del portal.",
      argsSchema: {
        rol: z.string(),
        tribunal: z.string().optional(),
        texto_fallo: z.string(),
        considerando: z.string().optional(),
        consulta: z.string().optional(),
      },
    },
    ({ rol, tribunal, texto_fallo, considerando, consulta }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Cita el fallo pegado sin inventar considerandos.",
              `ROL: ${rol}`,
              tribunal ? `Tribunal: ${tribunal}` : undefined,
              considerando ? `Considerando pedido: ${considerando}` : undefined,
              consulta
                ? `Tema para elegir considerando: ${consulta}`
                : undefined,
              "",
              "Llama `pegar_fallo_pjud` (o `citar_jurisprudencia` con texto) pasando el texto íntegro siguiente.",
              "Devuelve cita formal + blockquote + integrity. Si el considerando no existe, reporta la lista detectada.",
              "",
              "--- TEXTO DEL FALLO ---",
              texto_fallo,
            ]
              .filter((x): x is string => Boolean(x))
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "pegar_dictamen_cgr",
    {
      title: "Pegar dictamen CGR y citar",
      description:
        "Guía para citar un dictamen de Contraloría con texto pegado del portal.",
      argsSchema: {
        numero: z.string(),
        texto_dictamen: z.string(),
        url: z.string().optional(),
      },
    },
    ({ numero, texto_dictamen, url }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Cita el dictamen pegado. No inventes resolutivo ni número.",
              `Número: ${numero}`,
              url ? `URL: ${url}` : undefined,
              "",
              "Llama `citar_dictamen_pegado` con el texto. Si aún no hay texto, usa `resolver_dictamen` (solo enlace).",
              "",
              "--- TEXTO DEL DICTAMEN ---",
              texto_dictamen,
            ]
              .filter((x): x is string => Boolean(x))
              .join("\n"),
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
              "(3) buscar_jurisprudencia / buscar_tc; ROL TC -> obtener_fallo_tc / citar_jurisprudencia; PJUD -> pegar_fallo_pjud",
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
              "1) buscar_legislacion Codigo del Trabajo / obtener_articulo (idNorma 207436)",
              "2) buscar_jurisprudencia con filtros; PJUD -> pegar_fallo_pjud",
              "3) Listar pretensiones y normas citables con URL",
              "No inventes ROL ni montos.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "checklist_juicio_ejecutivo",
    {
      title: "Checklist juicio ejecutivo",
      description: "Título ejecutivo, CPC y pasos previos a demandar.",
      argsSchema: { hechos: z.string() },
    },
    ({ hechos }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Hechos / título invocado: ${hechos}`,
              "1) Código de Procedimiento Civil (idNorma 22740): títulos ejecutivos y procedimiento — obtener_articulo de arts. pertinentes",
              "2) Si hay pagaré/cheque/contrato: contrastar requisitos legales (no inventes cláusulas)",
              "3) buscar_jurisprudencia acotada; citar solo con texto verificado o pegar_fallo_pjud",
              "4) Checklist: competencia, liquidación, embargos posibles, excepciones típicas — sin montos inventados",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "checklist_familia",
    {
      title: "Checklist materia de familia",
      description: "Alimentos, cuidado personal u otras materias Ley 19.968.",
      argsSchema: { materia: z.string() },
    },
    ({ materia }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Materia de familia: ${materia}`,
              "1) Ley 19.968 Tribunales de Familia (idNorma 229557) + Código Civil (idNorma 172986) según corresponda — obtener_articulo",
              "2) Si hay matrimonio/divorcio: Ley 19.947 (idNorma 225128)",
              "3) buscar_jurisprudencia; PJUD -> pegar_fallo_pjud",
              "4) Listar pretensiones, medidas cautelares típicas y prueba — sin inventar ROLs ni montos de pensión",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "checklist_contencioso_administrativo",
    {
      title: "Checklist contencioso-administrativo / CGR",
      description: "Acto administrativo, 19.880/18.575 y dictámenes.",
      argsSchema: { hechos: z.string() },
    },
    ({ hechos }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Hechos / acto impugnado: ${hechos}`,
              "1) Ley 19.880 (idNorma 210676) y Ley 18.575 (idNorma 29967) — obtener_articulo de plazos, invalidación, recursos",
              "2) buscar_dictamenes / resolver_dictamen; con texto pegado -> citar_dictamen_pegado",
              "3) buscar_administrativo si hay superintendencia (portal_stub: no afirmar contenido)",
              "4) Lista: acto, vicios alegados, plazos, prueba documental — sin inventar dictámenes",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "checklist_recurso_nulidad_penal",
    {
      title: "Checklist recurso de nulidad penal",
      description: "CPP + causales a verificar antes de redactar.",
      argsSchema: { hechos: z.string() },
    },
    ({ hechos }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Hechos / sentencia impugnada: ${hechos}`,
              "1) Código Procesal Penal (idNorma 176595): causales y plazos de nulidad — obtener_articulo",
              "2) Si hay tipicidad/pena: Código Penal (idNorma 1984) según corresponda",
              "3) buscar_jurisprudencia / pegar_fallo_pjud para CS/CA",
              "4) Checklist: causal invocada, petitorio, puntos de hecho vs derecho — sin inventar ROL ni considerandos",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "checklist_recurso_casacion",
    {
      title: "Checklist recurso de casación (civil)",
      description: "CPC + requisitos de casación en el fondo/forma.",
      argsSchema: { hechos: z.string() },
    },
    ({ hechos }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Sentencia / hechos para casación: ${hechos}`,
              "1) Código de Procedimiento Civil (idNorma 22740): casación en la forma y/o en el fondo — obtener_articulo de causales y plazos",
              "2) Normas de fondo aplicables vía buscar_legislacion / citar_texto_legal (solo verified)",
              "3) Jurisprudencia CS: buscar_jurisprudencia → pegar_fallo_pjud / indice_considerandos",
              "4) Checklist: causal precisa, capítulos de casación, petitorio, preparación del recurso — sin inventar ROL ni considerandos",
              "5) Opcional: plantilla_escrito tipo generico + anexo_citas con lo verified",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "plantilla_escrito",
    {
      title: "Plantilla de escrito chileno",
      description:
        "Esqueleto de demanda/recurso según tipo, rellenado solo con tools verified.",
      argsSchema: {
        tipo: z.enum([
          "demanda_laboral",
          "recurso_proteccion",
          "juicio_ejecutivo",
          "contencioso_administrativo",
          "recurso_nulidad_penal",
          "recurso_casacion",
          "escrito_familia",
          "generico",
        ]),
        materia: z.string().optional(),
        hechos: z.string().optional(),
      },
    },
    ({ tipo, materia, hechos }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Usa plantilla_escrito tipo=${tipo}.`,
              materia ? `Materia: ${materia}` : undefined,
              hechos ? `Hechos: ${hechos}` : undefined,
              "Luego investiga con asesorar/investigar_tema, baja a texto oficial y rellena la plantilla.",
              "Marca [POR VERIFICAR] lo no verified. No inventes montos ni ROL.",
            ]
              .filter((x): x is string => Boolean(x))
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "minuta_cliente",
    {
      title: "Minuta o aviso al cliente",
      description:
        "Borrador de mensaje al cliente desde contexto aportado (causa o hallazgos).",
      argsSchema: {
        tipo: z.enum([
          "actualizacion_causa",
          "resumen_asesoria",
          "solicitud_antecedentes",
        ]),
        contexto: z.string(),
        rol_o_rit: z.string().optional(),
        caratulado: z.string().optional(),
      },
    },
    ({ tipo, contexto, rol_o_rit, caratulado }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Llama minuta_cliente tipo=${tipo}.`,
              rol_o_rit ? `ROL/RIT: ${rol_o_rit}` : undefined,
              caratulado ? `Caratulado: ${caratulado}` : undefined,
              "Redacta el mensaje final siguiendo la estructura. No inventes movimientos ni resoluciones.",
              "Si el contexto es PJUD, integrity=candidate.",
              "",
              "--- CONTEXTO ---",
              contexto,
            ]
              .filter((x): x is string => Boolean(x))
              .join("\n"),
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
