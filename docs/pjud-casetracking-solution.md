# PJUD Casetracking Solution

## 1. Problem

PJUD (Poder Judicial de Chile) does not offer a public API for case tracking (seguimiento de causas) or full-text jurisprudence search. The only official API found (estadisticaservices.pjud.cl) exposes aggregate statistics only, not individual case data.

To offer a "case tracking" feature equivalent to commercial products like Boostr or Red Judicial, the only path is to query PJUD's own public web portals directly: mainly "Oficina Judicial Virtual" (oficinajudicialvirtual.pjud.cl), which has a case search/consulta unificada flow.

## 2. Blocker: anti-bot protection

Two independent live-browser diagnostic passes confirmed that every one of PJUD's relevant domains sits behind the same F5/TSPD (F5 Distributed Cloud Bot Defense) WAF:

- `www.pjud.cl` (Portal Unificado de Sentencias / jurisprudence)
- `juris.pjud.cl`
- `oficinajudicialvirtual.pjud.cl` (case tracking / Consulta Unificada)

Every meaningful request against these portals returns a human-solve image+audio CAPTCHA ("What code is in the image?") tied to a unique per-session Support ID. This is not a transparent JS challenge that a headless browser can pass automatically — plain Playwright/Chromium automation gets stuck at the CAPTCHA every time.

We also attempted to sidestep the web CAPTCHA by reverse-engineering the official "Oficina Judicial Virtual" Android app's backend API. This turned out to be a dead end from an automated/sandbox environment:

- APK mirror sites (APKPure, APKCombo, apk.support) are themselves behind Cloudflare bot challenges.
- No APK decompilation tooling (jadx/apktool) was available to inspect the app even if it could be downloaded.
- This path would require a human to sideload the real app on a physical/emulated device and intercept its traffic with a tool like mitmproxy — not something an automated agent can do unsupervised.

## 3. Chosen solution

Rather than pay for a third-party aggregator (Boostr, Red Judicial — roughly $2 per query), the decision was to build an in-house case-tracking capability using:

**Playwright (headless Chromium) + a low-cost, pay-per-solve CAPTCHA-solving API (2Captcha or CapSolver), with session/cookie reuse to minimize how often the CAPTCHA actually needs to be paid for.**

This pattern (Playwright + paid CAPTCHA solver) is the industry-standard workaround used by existing PJUD scraper projects found on GitHub and in freelance job postings. Typical solver cost is ~$0.001–0.003 per solve, versus ~$2 per query for a commercial aggregator — and once a session cookie is validated, it can be reused for many subsequent lookups before it expires, so the CAPTCHA cost is paid rarely, not per request.

This decision explicitly accepts the risk of circumventing PJUD's anti-automation controls (Terms of Service risk), which the project owner has knowingly accepted for this feature.

## 4. Scope

This feature covers **case tracking only** (seguimiento de causas by RUT/nombre or by ROL/RIT/RUC). Jurisprudence search/citation stays exactly as it is today (free-source based: Tribunal Constitucional API + free web search + manual paste-in citation) and is not touched by this work.

## 5. Architecture

A new module, `src/sources/pjudCauses.ts`, owns a headless-browser session pool for Oficina Judicial Virtual.

Flow: acquire or reuse a validated session, submit the search form, detect the CAPTCHA, solve it via the solver API when needed, parse results, cache them, and release the session back to the pool for reuse by later calls. Session reuse is the key cost lever: solve once, reuse the cookie for many subsequent lookups until it expires or gets invalidated.

```
MCP tool: buscar_causa_pjud
        |
        v
PjudSessionManager
   |-- cached valid cookie --> reuse existing browser context
   |-- no session / expired --> launch new Playwright context
                                       |
                                       v
                            navigate to OJV search page
                                       |
                                       v
                              CAPTCHA present?
                              /              \
                           yes                no
                            |                  |
                   Solver API (2Captcha /      |
                   CapSolver): submit image,   |
                   poll for answer, submit     |
                   answer, validate session    |
                            |                  |
                            +--------+---------+
                                     v
                       reuse validated browser context
                                     |
                                     v
                     fill and submit case search form
                                     |
                                     v
                     parse results table / detail page
                                     |
                         +-----------+-----------+
                         v                       v
              store in pjudCauseCache (TTL)  return to MCP tool
                         |
                         v (cache hit path)
                  future calls read from cache directly
```

## 6. New dependencies

- **playwright** (npm), plus a postinstall/build step to install the Chromium binary (`npx playwright install --with-deps chromium`). On a free-tier host this increases build time and image size — a tradeoff that must be documented and validated against the platform's build-time limits.
- A **CAPTCHA-solving client** for 2Captcha or CapSolver. No SDK dependency is strictly required since both expose simple REST APIs (submit image, poll for text) — a thin custom HTTP client is enough.

## 7. New / changed files (reference implementation plan)

- `src/sources/pjudCauses.ts` (new) — Playwright session pool, CAPTCHA-solve integration, form fill/submit, results parsing into a `CausaPjud` type (tribunal, RIT, RUC, caratula, estado, litigantes, ultima actuacion).
- `src/sources/captchaSolver.ts` (new) — thin client for the solver API (submit image as base64, poll result, timeout/retry). Reads `CAPTCHA_SOLVER_API_KEY` and `CAPTCHA_SOLVER_PROVIDER` from environment variables; no-ops with a clear error if unset.
- `src/tools/causas.ts` (new) — registers `buscar_causa_pjud` (by RUT/nombre) and `obtener_causa_pjud` (by ROL/RIT/RUC) MCP tools, following the existing pattern used by the jurisprudence tools (timed search helper, ok/fail response helpers).
- `src/server.ts` — register the new causas tools alongside the other tool registrations.
- `src/upstream.ts` — add a new `pjudCauses` host key (separate from the existing `pjud` key used by websearch-based jurisprudence) with a very low max-concurrency (1) and a longer minimum interval between requests, since each call may drive a real browser session.
- `src/cache.ts` — add a `pjudCauseCache` (TTL cache) with a short TTL (case status changes at most daily) to avoid re-scraping the same RUT/ROL repeatedly.
- `src/types.ts` — add a `CausaPjud` interface for case-tracking results, distinct from the jurisprudence citation shape since causes have litigantes/estado/movimientos rather than citation/considerando text.
- `package.json` — add the `playwright` dependency and a postinstall/build step to install Chromium.
- `render.yaml` (or equivalent deploy config) — document that this feature requires `CAPTCHA_SOLVER_API_KEY` to work at all, but keep it optional so the rest of the MCP still runs without it.
- `README.md` — document the new tools, the new integrity considerations (this is scraped official-site data via a CAPTCHA-solving workaround, not a stable partner API), and the new environment variables.

## 8. Tool surface (MCP tools exposed to the LLM)

- **`buscar_causa_pjud(rut_o_nombre, tipo_persona, competencia?, formato?)`** — searches Oficina Judicial Virtual by RUT or name, returns a list of `CausaPjud` records (tribunal, RIT, RUC, caratula, fecha, estado, litigantes), mirroring what commercial aggregators return but scraped in-house.
- **`obtener_causa_pjud(rol_o_rit, tribunal?, formato?)`** — looks up a single case by identifier and returns full detail, including last actuación/movimientos when available.
- Both tools return an integrity level of **"candidate"** (never "verified" or "full_text"), since this is live-scraped data obtained via an anti-automation workaround. Results must carry a mandatory warning that PJUD itself does not endorse this access path and that case status can change without notice.
- Errors must surface distinctly for: CAPTCHA solve failure, solver quota/budget exhausted, PJUD-side timeout or layout change, and no-results-found — so the calling LLM gets an honest, specific failure rather than a generic error.

## 9. Configuration and safety

- **New environment variables:**
  - `CAPTCHA_SOLVER_PROVIDER` — `2captcha` or `capsolver`.
  - `CAPTCHA_SOLVER_API_KEY` — API key for the chosen solver.
  - `PJUD_CAUSAS_MAX_CONCURRENT` — max concurrent browser sessions (default: 1).
  - `PJUD_SESSION_TTL_MS` — how long a solved session/cookie is trusted before forcing a re-solve.
  - `PJUD_CAUSAS_DAILY_SOLVE_BUDGET` — hard cap on CAPTCHA solves per day, acting as a cost and abuse safety valve.
- **Graceful degradation:** if `CAPTCHA_SOLVER_API_KEY` is unset, the tools must not fail with an opaque error. Instead, they return a clear message plus the manual portal link (the same "portal stub" pattern already used for jurisprudence), consistent with the project's existing honesty conventions.
- **Kill switch:** a `PJUD_CAUSAS_ENABLED=0` environment variable fully disables the feature at runtime without a redeploy, given the ToS risk accepted for this feature.
- **Rate limiting / circuit breaker:** reuse the existing per-host rate-limit and circuit-breaker pattern so that repeated CAPTCHA failures (e.g., PJUD tightens its defenses) open the circuit and stop burning solver credits instead of retrying indefinitely.

## 10. Risks and open items

- PJUD's WAF may fingerprint and block the scraping IP/proxy over time regardless of solving the CAPTCHA; this may eventually require residential proxies, which adds further cost. Out of scope for the first pass — the daily solve budget and circuit breaker act as a safety valve in the meantime.
- Playwright + Chromium substantially increases build size/time on constrained/free hosting tiers; the build must be validated against the platform's build-time limits before shipping.
- This is a Terms-of-Service risk that has been knowingly accepted by the project owner: PJUD does not sanction automated CAPTCHA-solving access to its portals. The feature should stay clearly labeled as an unofficial workaround, with an independent kill switch, and should not be presented as an official or endorsed integration.
- Jurisprudence search/citation is explicitly out of scope and remains on its current free-source-only implementation.

## 11. Cost summary

| Item | Approx. cost |
|---|---|
| CAPTCHA solve (2Captcha / CapSolver) | ~$0.001 – $0.003 per solve |
| Commercial aggregator query (Boostr / Red Judicial, for comparison) | ~$2 per query |
| Session reuse | Amortizes the solve cost across many subsequent lookups per session |

The in-house approach is viable primarily because of session/cookie reuse: the CAPTCHA is the expensive/fragile step, but it does not need to be paid on every single lookup, only when a session is new or has expired.
