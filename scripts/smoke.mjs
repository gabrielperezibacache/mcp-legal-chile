#!/usr/bin/env node
/**
 * Smoke checks against a running server (default production URL or localhost).
 * Usage: SMOKE_BASE=https://mcp-legal-chile.onrender.com node scripts/smoke.mjs
 */
const BASE = (process.env.SMOKE_BASE ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);

async function mcp(method, params = {}, id = 1) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(process.env.MCP_API_KEY
        ? { Authorization: `Bearer ${process.env.MCP_API_KEY}` }
        : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result;
}

function ok(name) {
  console.log(`✓ ${name}`);
}

function fail(name, err) {
  console.error(`✗ ${name}:`, err);
  process.exitCode = 1;
}

async function main() {
  console.log(`Smoke against ${BASE}`);

  try {
    const health = await fetch(`${BASE}/health`).then((r) => r.json());
    if (!health.ok) throw new Error("health not ok");
    ok(`health v${health.version}`);
  } catch (e) {
    fail("health", e);
    return;
  }

  try {
    await fetch(`${BASE}/metrics`).then((r) => r.json());
    ok("metrics");
  } catch (e) {
    fail("metrics", e);
  }

  try {
    await mcp("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "smoke", version: "1.0" },
    });
    ok("initialize");
  } catch (e) {
    fail("initialize", e);
  }

  try {
    const tools = await mcp("tools/list", {}, 2);
    const names = tools.tools.map((t) => t.name);
    for (const required of [
      "obtener_articulo",
      "investigar_tema",
      "formatear_cita",
      "buscar_tc",
      "resolver_rol",
      "obtener_fallo_tc",
      "estado_norma",
    ]) {
      if (!names.includes(required)) throw new Error(`missing ${required}`);
    }
    ok(`tools/list (${names.length})`);
  } catch (e) {
    fail("tools/list", e);
  }

  try {
    const result = await mcp(
      "tools/call",
      {
        name: "obtener_norma",
        arguments: { id_norma: "141599", formato: "json" },
      },
      3,
    );
    const text = result.content[0].text;
    if (!text.includes("141599") && !text.includes("19628")) {
      throw new Error(text.slice(0, 200));
    }
    ok("obtener_norma 141599");
  } catch (e) {
    fail("obtener_norma", e);
  }

  try {
    const result = await mcp(
      "tools/call",
      {
        name: "obtener_articulo",
        arguments: { id_norma: "141599", articulo: "2", formato: "markdown" },
      },
      4,
    );
    const text = result.content[0].text;
    if (!/art[ií]culo\s*2/i.test(text) && !text.includes("LeyChile")) {
      // soft: rate limit is acceptable in smoke
      if (/429|Circuito|No se pudo/.test(text)) {
        ok("obtener_articulo (soft fail / rate limit documented)");
      } else {
        throw new Error(text.slice(0, 240));
      }
    } else {
      ok("obtener_articulo 2");
    }
  } catch (e) {
    fail("obtener_articulo", e);
  }

  console.log(process.exitCode ? "Smoke finished with failures" : "Smoke OK");
}

main();
