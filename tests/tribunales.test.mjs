import test from "node:test";
import assert from "node:assert/strict";
import {
  matchTribunalPortal,
  tribunalSearchSites,
  TRIBUNAL_PORTALS,
} from "../dist/sources/tribunalesCatalog.js";

test("catálogo incluye tribunales ampliados", () => {
  const ids = TRIBUNAL_PORTALS.map((p) => p.id);
  for (const id of [
    "familia",
    "garantia",
    "oral_penal",
    "1ta",
    "2ta",
    "tce",
    "tta",
    "tcp",
  ]) {
    assert.ok(ids.includes(id), `falta ${id}`);
  }
});

test("matchTribunalPortal resuelve familia", () => {
  const portal = matchTribunalPortal("Juzgado de Familia de Santiago");
  assert.equal(portal?.id, "familia");
});

test("tribunalSearchSites usa sitios del portal", () => {
  const sites = tribunalSearchSites("TDLC");
  assert.ok(sites.includes("tdlc.cl"));
});
