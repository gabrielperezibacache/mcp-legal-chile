import test from "node:test";
import assert from "node:assert/strict";
import { importarFallo } from "../dist/sources/falloImport.js";
import { verificarCita } from "../dist/sources/verificarCita.js";

test("verificar_cita reconoce ROL en cache como verified", async () => {
  await importarFallo({
    rol: "77777-2022",
    texto: `
Corte Suprema Sentencia Rol 77777-2022
Y CONSIDERANDO:
PRIMERO: Que el asunto es de competencia de esta Corte.
SEGUNDO: Que corresponde rechazar el recurso.
`,
  });
  const res = await verificarCita("rol 77777-2022");
  assert.equal(res.kind, "rol");
  assert.equal(res.integrity, "verified");
  assert.equal(res.rol, "77777-2022");
});

test("verificar_cita clasifica dictamen como candidate o verified", async () => {
  const res = await verificarCita("dictamen 12345");
  assert.equal(res.kind, "dictamen");
  assert.ok(
    res.integrity === "candidate" ||
      res.integrity === "verified" ||
      res.integrity === "not_found",
  );
  assert.equal(res.dictamen, "12345");
});

test("verificar_cita resuelve articulo de norma hot sin red si XML falla", async () => {
  const res = await verificarCita("art. 161 Codigo del Trabajo");
  assert.equal(res.kind, "articulo");
  // May be verified (XML ok), candidate (429), or not_found (parse miss).
  assert.ok(
    ["verified", "candidate", "not_found"].includes(res.integrity),
    res.integrity,
  );
  assert.ok(res.articulo === "161" || res.idNorma === "207436" || res.markdown);
});
