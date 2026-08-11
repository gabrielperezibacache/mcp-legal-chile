#!/usr/bin/env node
/**
 * Regression probe for Hermes-reported integrity bugs (v1.23+).
 * Usage: SMOKE_BASE=http://127.0.0.1:3105 node scripts/integrity-probe.mjs
 */
const BASE = (process.env.SMOKE_BASE ?? "http://127.0.0.1:3105").replace(/\/$/, "");
const findings = [];

async function mcp(method, params = {}, id = 1) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), Number(process.env.PROBE_TIMEOUT_MS ?? 50000));
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
  return { text, isError: Boolean(result?.isError), structured: result?.structuredContent };
}

function note(severity, id, message, sample = "") {
  findings.push({ severity, id, message, sample: sample.slice(0, 240) });
  const mark = severity === "fail" ? "✗" : severity === "warn" ? "!" : "✓";
  console.log(`${mark} [${id}] ${message}`);
  if (sample && severity !== "ok") console.log(`    … ${sample.slice(0, 160).replace(/\n/g, " ")}`);
}

const POISON = /spanishdict|dle\.rae\.es|rae\.es|nexusmods|merriam-webster|concepto\.de|datalounge|dictionary\.com|wikipedia\.org\/wiki\/(?!.*contraloria)/i;

async function main() {
  console.log(`Integrity probe against ${BASE}\n`);
  await mcp("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "integrity-probe", version: "1.0" },
  });

  // 1) CGR search must not return poison hosts
  {
    const id = "CGR-search";
    const r = await callTool("buscar_dictamenes", {
      consulta: "municipalidades contratación honorarios",
      limite: 8,
      formato: "json",
    });
    if (POISON.test(r.text)) {
      note("fail", id, "buscar_dictamenes contiene hosts ajenos", r.text);
    } else if (/Contraloría|contraloria\.cl|candidate|portal|descartaron|Sin cuerpo|dictamen/i.test(r.text)) {
      note("ok", id, "buscar_dictamenes sin hosts tóxicos");
    } else {
      note("warn", id, "buscar_dictamenes respuesta inesperada", r.text);
    }
    if (/integrity["']?\s*[:=]\s*["']verified["']/i.test(r.text) && POISON.test(r.text)) {
      note("fail", id, "verified en host ajeno", r.text);
    }
  }

  // 2) resolver dictamen E-number
  {
    const id = "CGR-resolver";
    const r = await callTool("resolver_dictamen", {
      numero: "E370813/2023",
      formato: "json",
    });
    if (POISON.test(r.text)) {
      note("fail", id, "resolver_dictamen devolvió diccionarios/RAE", r.text);
    } else {
      note("ok", id, "resolver_dictamen sin contaminación SERP");
    }
    if (/publisher["']?\s*:\s*["']Contraloría/i.test(r.text) && POISON.test(r.text)) {
      note("fail", id, "publisher Contraloría en URL ajena", r.text);
    }
  }

  // 3) investigar_tema must not put RAE in CGR section as verified
  {
    const id = "pack-cgr";
    const r = await callTool("investigar_tema", {
      consulta: "responsabilidad médica por error de diagnóstico en Chile",
      perfil: "fast",
      limite_por_fuente: 3,
    });
    const cgrSection = r.text.split(/Actos administrativos|Dictámenes/i)[1]?.slice(0, 2500) ?? r.text;
    if (POISON.test(cgrSection) && /verified|full_text/i.test(cgrSection)) {
      note("fail", id, "pack marca web genérica verified en CGR", cgrSection);
    } else if (POISON.test(cgrSection)) {
      note("warn", id, "pack aún menciona host ajeno (sin verified?)", cgrSection);
    } else {
      note("ok", id, "pack sin hosts tóxicos verified en CGR");
    }
  }

  // 4) TC considerando 787 must be rejected
  {
    const id = "TC-787";
    const fallo = await callTool("obtener_fallo_tc", { rol: "14138-2023", formato: "markdown" });
    if (/considerando\s*787\b/i.test(fallo.text) && /índice|indice|considerandos/i.test(fallo.text)) {
      // soft: if listed in index it's a parser leak
      note("fail", id, "obtener_fallo_tc indexa considerando 787", fallo.text);
    } else {
      note("ok", id, "obtener_fallo_tc no indexa 787 (o soft fail red)");
    }
    const cite = await callTool("citar_jurisprudencia", {
      rol: "14138-2023",
      considerando: "787",
    });
    if (/verified|full_text/i.test(cite.text) && /787/.test(cite.text) && !/no |rechaz|inexist|no encontr|NO VERIFICADO/i.test(cite.text)) {
      note("fail", id, "citar_jurisprudencia aceptó considerando 787", cite.text);
    } else {
      note("ok", id, "citar_jurisprudencia rechaza/no inventa 787");
    }
  }

  // 5) Citation formatting
  {
    const id = "cita-CP";
    const r = await callTool("formatear_cita", {
      tipo: "Código",
      numero: "PENAL",
      articulo: "454",
      estilo: "chile",
    });
    if (/N°\s*PENAL/i.test(r.text)) note("fail", id, "aún genera Código N° PENAL", r.text);
    else if (/Código Penal/i.test(r.text)) note("ok", id, "cita Código Penal correcta");
    else note("warn", id, "formatear_cita respuesta rara", r.text);
  }

  // 6) HTTP error messaging (invalid id should not hang forever)
  {
    const id = "leychile-404";
    const started = Date.now();
    const r = await callTool("obtener_articulo", {
      id_norma: "999999999",
      articulo: "1",
      formato: "markdown",
    });
    const ms = Date.now() - started;
    if (ms > 25000) note("fail", id, `timeout excesivo ${ms}ms`, r.text);
    else if (/401|403|404|no encontr|No se pudo|XML|Fuente oficial/i.test(r.text)) {
      note("ok", id, `fail usable en ${ms}ms`);
    } else note("warn", id, `respuesta ambigua en ${ms}ms`, r.text);
  }

  const fails = findings.filter((f) => f.severity === "fail");
  const warns = findings.filter((f) => f.severity === "warn");
  console.log(`\n=== SUMMARY ok=${findings.filter((f) => f.severity === "ok").length} warn=${warns.length} fail=${fails.length} ===`);
  for (const f of fails) console.log(`FAIL [${f.id}] ${f.message}`);
  for (const f of warns) console.log(`WARN [${f.id}] ${f.message}`);
  if (fails.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
