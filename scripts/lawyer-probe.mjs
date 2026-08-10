#!/usr/bin/env node
/**
 * Lawyer-persona probe: realistic Chilean legal workflows against a live MCP.
 * Usage: SMOKE_BASE=http://127.0.0.1:3099 node scripts/lawyer-probe.mjs
 */
const BASE = (process.env.SMOKE_BASE ?? "http://127.0.0.1:3099").replace(
  /\/$/,
  "",
);

const findings = [];

async function mcp(method, params = {}, id = 1) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), Number(process.env.PROBE_TIMEOUT_MS ?? 45000));
  try {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: ac.signal,
    });
    const data = await res.json();
    if (data.error) throw new Error(JSON.stringify(data.error));
    return data.result;
  } finally {
    clearTimeout(t);
  }
}

async function callTool(name, args = {}) {
  const result = await mcp("tools/call", { name, arguments: args }, Math.floor(Math.random() * 1e6));
  const text = result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
  const isError = Boolean(result?.isError);
  return { text, isError, result };
}

function note(severity, caseId, message, sample = "") {
  findings.push({ severity, caseId, message, sample: sample.slice(0, 280) });
  const mark = severity === "fail" ? "✗" : severity === "warn" ? "!" : "✓";
  console.log(`${mark} [${caseId}] ${message}`);
  if (sample && severity !== "ok") console.log(`    … ${sample.slice(0, 180).replace(/\n/g, " ")}`);
}

function hasIntegrityLeak(text) {
  // Claiming verified content while only showing portal/candidate language poorly.
  return /integrity["']?\s*[:=]\s*["']verified["']/i.test(text) &&
    /sin texto recuperado|demotedFromVerified|portal_stub/i.test(text);
}

async function main() {
  console.log(`Lawyer probe against ${BASE}\n`);
  await mcp("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "lawyer-probe", version: "1.0" },
  });

  // --- Case A: despido laboral — hot + artículo CT ---
  {
    const id = "A-despido";
    const hot = await callTool("resolver_norma_frecuente", {
      alias: "codigo del trabajo",
    });
    if (!/207436/.test(hot.text)) note("fail", id, "hot CT no resuelve a 207436", hot.text);
    else note("ok", id, "hot CT → 207436");

    const art = await callTool("obtener_articulo", {
      id_norma: "207436",
      articulo: "161",
      formato: "markdown",
    });
    if (art.isError && !/429|Circuito|No se pudo|rate|red|timeout/i.test(art.text)) {
      note("fail", id, "obtener_articulo 161 CT error duro", art.text);
    } else if (/429|Circuito|reintenta|red|timeout|No se pudo contactar/i.test(art.text)) {
      note("warn", id, "LeyChile soft-degrade en art. 161 CT", art.text);
    } else if (!/161|necesidades de la empresa|desahucio/i.test(art.text)) {
      note("fail", id, "art. 161 CT sin texto útil", art.text);
    } else {
      note("ok", id, "art. 161 CT con texto");
    }

    const ver = await callTool("verificar_cita", { cita: "art. 161 codigo del trabajo" });
    if (ver.isError) note("fail", id, "verificar_cita CT falló", ver.text);
    else if (!/verified|candidate|207436|161/i.test(ver.text)) {
      note("fail", id, "verificar_cita CT respuesta pobre", ver.text);
    } else note("ok", id, "verificar_cita art. 161 CT");
  }

  // --- Case B: protección constitucional ---
  {
    const id = "B-proteccion";
    const art = await callTool("obtener_articulo", {
      id_norma: "242302",
      articulo: "19",
      formato: "markdown",
    });
    if (/429|Circuito|red|timeout|No se pudo contactar/i.test(art.text)) {
      note("warn", id, "CPR art.19 soft-degrade", art.text);
    } else if (!/Constituci|igualdad|libertad|propiedad|19/i.test(art.text)) {
      note("fail", id, "CPR art.19 sin garantías", art.text);
    } else note("ok", id, "CPR art.19 texto");

    const pack = await callTool("investigar_tema", {
      consulta: "recurso de proteccion art 19 garantia igualdad",
      area: "constitucional",
      perfil: "fast",
      limite_por_fuente: 3,
    });
    if (pack.isError) note("fail", id, "investigar_tema proteccion error", pack.text);
    else if (!/Legislaci|Jurisprud|qu[eé] falta|parcial|Doctrina/i.test(pack.text)) {
      note("fail", id, "pack proteccion sin secciones esperadas", pack.text);
    } else if (hasIntegrityLeak(pack.text)) {
      note("fail", id, "pack proteccion integrity leak", pack.text);
    } else note("ok", id, "investigar_tema proteccion (fast)");
  }

  // --- Case C: extracontractual CC 2314 ---
  {
    const id = "C-civil-2314";
    const hot = await callTool("resolver_norma_frecuente", {
      consulta: "responsabilidad extracontractual art 2314",
    });
    if (!/172986/.test(hot.text)) {
      note("fail", id, "hot 2314 no apunta a Código Civil", hot.text);
    } else note("ok", id, "hot 2314 → CC");

    const ver = await callTool("verificar_cita", { cita: "artículo 2314 código civil" });
    if (!/172986|2314|verified|candidate/i.test(ver.text)) {
      note("fail", id, "verificar_cita 2314 pobre", ver.text);
    } else note("ok", id, "verificar_cita 2314");
  }

  // --- Case D: Ley Karin / laboral admin DT ---
  {
    const id = "D-karin-dt";
    const hot = await callTool("resolver_norma_frecuente", { alias: "ley karin" });
    if (!/1200096|21\.?643|Karin/i.test(hot.text)) {
      note("fail", id, "Ley Karin no resuelve", hot.text);
    } else note("ok", id, "Ley Karin hot");

    const dt = await callTool("buscar_dictamenes_dt", {
      consulta: "jornada extraordinaria",
      limite: 3,
    });
    if (dt.isError && !/429|Circuito|timeout/i.test(dt.text)) {
      note("fail", id, "buscar_dictamenes_dt error duro", dt.text);
    } else if (!/dictamen|DT|Trabajo|candidato|enlace|candidate|portal|resultado/i.test(dt.text)) {
      note("warn", id, "DT sin resultados útiles (posible bloqueo)", dt.text);
    } else note("ok", id, "buscar_dictamenes_dt responde");
  }

  // --- Case E: CGR / verificar dictamen ---
  {
    const id = "E-cgr";
    const ver = await callTool("verificar_cita", { cita: "dictamen 10000 Contraloria" });
    if (ver.isError) note("fail", id, "verificar_cita dictamen error", ver.text);
    else if (/verified/i.test(ver.text) && !/extracto|texto|cuerpo|summary/i.test(ver.text)) {
      note("fail", id, "dictamen marked verified sin cuerpo aparente", ver.text);
    } else if (!/candidate|verified|portal|no encontr|dictamen/i.test(ver.text)) {
      note("fail", id, "verificar_cita dictamen respuesta vacía", ver.text);
    } else note("ok", id, "verificar_cita dictamen honesto");
  }

  // --- Case F: TC / jurisprudencia ---
  {
    const id = "F-tc";
    const tc = await callTool("buscar_tc", { consulta: "libertad de expresion", limite: 3 });
    if (tc.isError) note("fail", id, "buscar_tc error", tc.text);
    else if (!/TC|tribunal|rol|resultado|fallo/i.test(tc.text)) {
      note("warn", id, "buscar_tc sin hits claros", tc.text);
    } else note("ok", id, "buscar_tc");

    const juris = await callTool("buscar_jurisprudencia", {
      consulta: "despido injustificado tutela",
      limite: 5,
    });
    if (juris.isError) note("fail", id, "buscar_jurisprudencia error", juris.text);
    else if (/portal_stub/i.test(juris.text) && /verified/i.test(juris.text)) {
      note("fail", id, "juris mezcla portal_stub con verified", juris.text);
    } else note("ok", id, "buscar_jurisprudencia responde");
  }

  // --- Case G: workflow abogado (asesorar / siguiente paso) ---
  {
    const id = "G-workflow";
    const cat = await callTool("catalogo_flujos", {});
    if (!/asesorar|flujo/i.test(cat.text)) note("fail", id, "catalogo_flujos vacío", cat.text);
    else note("ok", id, "catalogo_flujos");

    const ase = await callTool("asesorar", {
      consulta: "Cliente despedido por necesidades de la empresa, pide tutela y despido injustificado",
    });
    if (ase.isError) note("fail", id, "asesorar error", ase.text);
    else if (!/herramienta|tool|siguiente|norma|CT|laboral|investigar|citar/i.test(ase.text)) {
      note("fail", id, "asesorar sin plan de tools útil", ase.text);
    } else note("ok", id, "asesorar da plan");

    const next = await callTool("siguiente_paso", {
      consulta: "Ya tengo el art. 161 CT, ¿qué sigue para demanda laboral?",
    });
    if (next.isError) note("fail", id, "siguiente_paso error", next.text);
    else if (!/buscar_jurisprudencia|pegar_fallo|IRAC|escrito|anexo/i.test(next.text)) {
      note("warn", id, "siguiente_paso sin sugerencias de litigio", next.text);
    } else note("ok", id, "siguiente_paso infiere desde consulta");
  }

  // --- Case H: mapa_norma + vigencia ---
  {
    const id = "H-mapa";
    const mapa = await callTool("mapa_norma", { id_norma: "207436", formato: "markdown" });
    if (mapa.isError && !/429|Circuito/i.test(mapa.text)) {
      note("fail", id, "mapa_norma CT error", mapa.text);
    } else if (/429|Circuito/i.test(mapa.text)) {
      note("warn", id, "mapa_norma rate-limit", mapa.text);
    } else if (!/art[ií]culo|índice|indice|derogad|207436/i.test(mapa.text)) {
      note("fail", id, "mapa_norma sin índice útil", mapa.text);
    } else note("ok", id, "mapa_norma CT");
  }

  // --- Case I: consumidor / SERNAC ---
  {
    const id = "I-sernac";
    const hot = await callTool("resolver_norma_frecuente", { alias: "ley del consumidor" });
    if (!/61438|19\.?496/i.test(hot.text)) note("fail", id, "LPC hot fail", hot.text);
    else note("ok", id, "LPC hot");

    const ser = await callTool("buscar_circulares_sernac", {
      consulta: "garantia legal",
      limite: 3,
    });
    if (ser.isError && !/429|Circuito/i.test(ser.text)) {
      note("fail", id, "SERNAC error duro", ser.text);
    } else note("ok", id, "buscar_circulares_sernac responde");
  }

  // --- Case J: importar_fallo / citar con considerando inventado ---
  {
    const id = "J-fallo";
    const texto = `Santiago, diez de enero de dos mil veinticuatro.
Causa Rol 1234-2023.
CONSIDERANDO:
PRIMERO: Que el demandante alega despido injustificado.
SEGUNDO: Que corresponde acoger la demanda.
Y TENIENDO PRESENTE lo dispuesto en el artículo 161 del Código del Trabajo,
se resuelve acoger la demanda.`;
    const imp = await callTool("importar_fallo", { texto, rol: "1234-2023" });
    if (imp.isError) note("fail", id, "importar_fallo error", imp.text);
    else if (!/PRIMERO|SEGUNDO|considerando/i.test(imp.text)) {
      note("fail", id, "importar_fallo no indexa considerandos", imp.text);
    } else note("ok", id, "importar_fallo indexa");

    const bad = await callTool("citar_jurisprudencia", {
      rol: "1234-2023",
      considerando: "99",
    });
    if (/DÉCIMO|NOVENO|PRIMERO:|invent/i.test(bad.text) && !/no se|rechaz|no exist|no encontr/i.test(bad.text)) {
      note("fail", id, "citar_jurisprudencia podría inventar cons. 99", bad.text);
    } else if (!/no |rechaz|inexist|no encontr|error|falt/i.test(bad.text) && !bad.isError) {
      // soft: some paths ask for paste
      note("warn", id, "cons.99 respuesta ambigua (revisar anti-alucinación)", bad.text);
    } else note("ok", id, "cons.99 rechazado o no inventado");
  }

  // Summary
  const fails = findings.filter((f) => f.severity === "fail");
  const warns = findings.filter((f) => f.severity === "warn");
  const oks = findings.filter((f) => f.severity === "ok");
  console.log("\n=== SUMMARY ===");
  console.log(`ok=${oks.length} warn=${warns.length} fail=${fails.length}`);
  if (fails.length) {
    console.log("\nFAILURES:");
    for (const f of fails) console.log(`- [${f.caseId}] ${f.message}`);
  }
  if (warns.length) {
    console.log("\nWARNINGS:");
    for (const f of warns) console.log(`- [${f.caseId}] ${f.message}`);
  }

  // Machine-readable for follow-up fixes
  const outPath = new URL("../tmp-lawyer-probe.json", import.meta.url);
  const { writeFileSync, mkdirSync } = await import("node:fs");
  try {
    mkdirSync(new URL("..", outPath), { recursive: true });
  } catch { /* ignore */ }
  writeFileSync(
    new URL("../lawyer-probe-results.json", import.meta.url),
    JSON.stringify({ base: BASE, findings }, null, 2),
  );
  console.log("\nWrote scripts/lawyer-probe-results.json");
  if (fails.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
