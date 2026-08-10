import test from "node:test";
import assert from "node:assert/strict";
import {
  findArticulo,
  parseNormaTexto,
} from "../dist/sources/normaTexto.js";

test("DEMO_MODE sirve CPR fixture sin red", async () => {
  const prev = process.env.DEMO_MODE;
  process.env.DEMO_MODE = "1";
  try {
    const norma = await parseNormaTexto("242302");
    assert.equal(norma.idNorma, "242302");
    const art19 = findArticulo(norma, "19");
    assert.ok(art19);
    assert.match(art19.texto, /Constituci[oó]n asegura/i);
    const artBis = findArticulo(norma, "37 bis");
    assert.ok(artBis);
  } finally {
    if (prev === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = prev;
  }
});

test("DEMO_MODE rechaza idNorma sin fixture", async () => {
  const prev = process.env.DEMO_MODE;
  process.env.DEMO_MODE = "1";
  try {
    await assert.rejects(
      () => parseNormaTexto("999999"),
      /DEMO_MODE|fixture/i,
    );
  } finally {
    if (prev === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = prev;
  }
});
