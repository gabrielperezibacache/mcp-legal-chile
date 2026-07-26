#!/usr/bin/env node
/**
 * Conditionally installs the Playwright Chromium binary.
 *
 * The `pjudCauses` case-tracking feature (see docs/pjud-casetracking-solution.md)
 * is the only consumer of Playwright in this project, and it is opt-in via
 * PJUD_CAUSAS_ENABLED=1. Downloading Chromium substantially increases build
 * time/image size on free-tier hosts, so we skip it entirely unless the
 * feature is explicitly enabled — the default `npm ci && npm run build`
 * (e.g. render.yaml) stays fast and small.
 */
import { execSync } from "node:child_process";

if (process.env.PJUD_CAUSAS_ENABLED !== "1") {
  console.log(
    "[installPlaywright] PJUD_CAUSAS_ENABLED != 1: skipping Chromium download " +
      "(buscar_causa_pjud/obtener_causa_pjud will run in degraded/portal_stub mode).",
  );
  process.exit(0);
}

try {
  console.log(
    "[installPlaywright] PJUD_CAUSAS_ENABLED=1: installing Chromium for Playwright...",
  );
  execSync("npx playwright install --with-deps chromium", {
    stdio: "inherit",
  });
} catch (error) {
  console.warn(
    "[installPlaywright] Chromium install failed; pjudCauses will fall back " +
      "to degraded/portal_stub mode at runtime.",
    error instanceof Error ? error.message : error,
  );
}
