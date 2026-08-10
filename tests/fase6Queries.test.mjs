import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inferLegalArea,
  resolveHotNorma,
} from "../dist/catalog.js";
import { pickAdminSearch } from "../dist/sources/research.js";

const queries = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures/lawyer-queries.json"),
    "utf8",
  ),
);

test("lawyer-queries.json tiene al menos 30 consultas", () => {
  assert.ok(queries.length >= 30);
});

test("regresión offline: área, hot norma y admin por consulta abogado", () => {
  for (const row of queries) {
    if (row.area) {
      assert.equal(
        inferLegalArea(row.q),
        row.area,
        `área para «${row.q}»: esperado ${row.area}`,
      );
    }
    if (row.hotIdNorma) {
      const hot = resolveHotNorma(row.q);
      assert.equal(
        hot?.idNorma,
        row.hotIdNorma,
        `hot norma para «${row.q}»: esperado ${row.hotIdNorma}, got ${hot?.idNorma}`,
      );
    }
    if (row.admin) {
      const area = row.area ?? inferLegalArea(row.q);
      assert.equal(
        pickAdminSearch(row.q, area),
        row.admin,
        `admin para «${row.q}»: esperado ${row.admin}`,
      );
    }
  }
});
