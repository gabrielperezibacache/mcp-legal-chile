import test from "node:test";
import assert from "node:assert/strict";
import {
  LATAM_REFERENCE_JOURNALS,
  issnsForCountry,
} from "../dist/sources/journalCatalog.js";
import { extractDtNumber } from "../dist/sources/dictamenesDt.js";
import { upstreamHostKey } from "../dist/upstream.js";

test("extractDtNumber reconoce Ord. y dictamen", () => {
  assert.equal(extractDtNumber("Ord. N° 1234/2020"), "1234/2020");
  assert.equal(extractDtNumber("dictamen 5678"), "5678");
  assert.equal(extractDtNumber("sin numero"), undefined);
});

test("LATAM catalog engrosado por pais", () => {
  assert.ok(LATAM_REFERENCE_JOURNALS.length >= 18);
  for (const country of ["PE", "BR", "AR", "MX", "CO"]) {
    const issns = issnsForCountry(country);
    assert.ok(
      issns.length >= 4,
      `${country} debería tener ≥4 ISSN (tiene ${issns.length})`,
    );
  }
});

test("upstreamHostKey clasifica DT SERNAC CMF", () => {
  assert.equal(upstreamHostKey("https://www.dt.gob.cl/portal/x"), "dt");
  assert.equal(upstreamHostKey("https://www.sernac.cl/circular"), "sernac");
  assert.equal(upstreamHostKey("https://www.cmfchile.cl/normativa"), "cmf");
});
