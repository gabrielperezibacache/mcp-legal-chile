/**
 * PJUD case-tracking (seguimiento de causas) via Oficina Judicial Virtual.
 *
 * UNOFFICIAL / ToS-risk feature: PJUD's Consulta Unificada sits behind an
 * F5/TSPD anti-bot WAF that always shows a human-solve image+audio CAPTCHA.
 * This module drives a pooled headless-browser (Playwright) session, pays a
 * third-party solver (2Captcha/CapSolver) to clear the CAPTCHA only when no
 * validated session cookie is available, and reuses that session for
 * subsequent lookups until it expires. See
 * docs/pjud-casetracking-solution.md for the full design and the accepted
 * risk tradeoffs.
 *
 * Disabled by default: every entry point below no-ops into a portal_stub
 * response unless PJUD_CAUSAS_ENABLED=1 AND a CAPTCHA solver is configured.
 */

import type { CausaPjud, CausaPjudSearchResponse } from "../types.js";
import { pjudCauseCache } from "../cache.js";
import { withUpstreamLimit } from "../upstream.js";
import {
  captchaSolverConfigured,
  CaptchaSolveError,
  CaptchaSolverConfigError,
  solveImageCaptcha,
} from "./captchaSolver.js";

const OJV_BASE = "https://oficinajudicialvirtual.pjud.cl";
const OJV_SEARCH_URL = `${OJV_BASE}/home/index.php`;
const OJV_CONSULTA_UNIFICADA_URL =
  "https://www.pjud.cl/consulta-unificada-de-causas";

export const PJUD_CAUSAS_PORTAL_URL = OJV_CONSULTA_UNIFICADA_URL;

function causasEnabled(): boolean {
  return process.env.PJUD_CAUSAS_ENABLED === "1";
}

export class PjudCausasSolverBudgetError extends Error {
  constructor(limit: number) {
    super(
      `Presupuesto diario de resoluciones de CAPTCHA agotado (${limit}). Reintenta mañana o sube PJUD_CAUSAS_DAILY_SOLVE_BUDGET.`,
    );
    this.name = "PjudCausasSolverBudgetError";
  }
}

export class PjudCausasCaptchaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PjudCausasCaptchaError";
  }
}

export class PjudCausasTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PjudCausasTimeoutError";
  }
}

export class PjudCausasNoResultsError extends Error {
  constructor(message = "Sin resultados para la búsqueda.") {
    super(message);
    this.name = "PjudCausasNoResultsError";
  }
}

/** Daily solver-spend safety valve (docs/pjud-casetracking-solution.md §9). */
const DAILY_SOLVE_BUDGET = Number(
  process.env.PJUD_CAUSAS_DAILY_SOLVE_BUDGET ?? 50,
);
const solveBudgetState = { day: "", used: 0 };

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function assertSolveBudget(): void {
  const day = todayUtc();
  if (solveBudgetState.day !== day) {
    solveBudgetState.day = day;
    solveBudgetState.used = 0;
  }
  if (solveBudgetState.used >= DAILY_SOLVE_BUDGET) {
    throw new PjudCausasSolverBudgetError(DAILY_SOLVE_BUDGET);
  }
}

function noteSolveUsed(): void {
  solveBudgetState.used += 1;
}

const SESSION_TTL_MS = Number(process.env.PJUD_SESSION_TTL_MS ?? 25 * 60_000);

interface PjudSession {
  cookies: import("playwright").Cookie[];
  createdAt: number;
}

let currentSession: PjudSession | undefined;
let sessionPromise: Promise<PjudSession> | undefined;

function sessionIsValid(session: PjudSession | undefined): boolean {
  if (!session) return false;
  return Date.now() - session.createdAt < SESSION_TTL_MS;
}

/**
 * Launches a fresh headless Chromium context, navigates to the OJV search
 * page, solves the F5/TSPD image CAPTCHA via the configured solver API, and
 * returns the resulting validated cookie jar. Throws PjudCausasCaptchaError /
 * PjudCausasTimeoutError on failure so callers can surface a specific
 * message rather than a generic error (docs/pjud-casetracking-solution.md §8).
 */
async function solveNewSession(signal?: AbortSignal): Promise<PjudSession> {
  assertSolveBudget();
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      locale: "es-CL",
    });
    const page = await context.newPage();
    try {
      await page.goto(OJV_SEARCH_URL, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
    } catch (error) {
      throw new PjudCausasTimeoutError(
        `Timeout navegando a Oficina Judicial Virtual: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const captchaImage = page.locator(
      'img[src*="captcha"], img[alt*="captcha" i], #captcha_image, .captcha-image img',
    );
    const hasCaptcha = (await captchaImage.count()) > 0;

    if (hasCaptcha) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      let imageBase64: string;
      try {
        const buffer = await captchaImage.first().screenshot();
        imageBase64 = buffer.toString("base64");
      } catch (error) {
        throw new PjudCausasCaptchaError(
          `No se pudo capturar la imagen del CAPTCHA: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      let answer: string;
      try {
        answer = await solveImageCaptcha(imageBase64, signal);
      } catch (error) {
        if (
          error instanceof CaptchaSolverConfigError ||
          error instanceof CaptchaSolveError
        ) {
          throw new PjudCausasCaptchaError(error.message);
        }
        throw error;
      }
      noteSolveUsed();

      const captchaInput = page.locator(
        'input[name*="captcha" i], #captcha_response, input[type="text"][id*="captcha" i]',
      );
      await captchaInput.first().fill(answer);
      const submitButton = page.locator(
        'button[type="submit"], input[type="submit"]',
      );
      await Promise.all([
        page
          .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 })
          .catch(() => undefined),
        submitButton.first().click(),
      ]);

      const stillBlocked = (await captchaImage.count()) > 0;
      if (stillBlocked) {
        throw new PjudCausasCaptchaError(
          "PJUD rechazó la respuesta del CAPTCHA (posible respuesta incorrecta del solver o sesión bloqueada).",
        );
      }
    }

    const cookies = await context.cookies();
    if (cookies.length === 0) {
      throw new PjudCausasCaptchaError(
        "No se obtuvo cookie de sesión válida tras resolver el CAPTCHA.",
      );
    }
    return { cookies, createdAt: Date.now() };
  } finally {
    await browser.close();
  }
}

async function getValidSession(signal?: AbortSignal): Promise<PjudSession> {
  if (sessionIsValid(currentSession)) return currentSession!;
  if (sessionPromise) return sessionPromise;
  sessionPromise = solveNewSession(signal)
    .then((session) => {
      currentSession = session;
      return session;
    })
    .finally(() => {
      sessionPromise = undefined;
    });
  return sessionPromise;
}

/** Force a fresh CAPTCHA solve on the next lookup (e.g. after PJUD rejects the reused cookie). */
function invalidateSession(): void {
  currentSession = undefined;
}

export type BuscarCausaTipoPersona = "natural" | "juridica";

export interface BuscarCausaPjudOptions {
  competencia?: string;
  signal?: AbortSignal;
}

export interface ObtenerCausaPjudOptions {
  tribunal?: string;
  signal?: AbortSignal;
}

function parseCausasFromHtml(html: string, baseUrl: string): CausaPjud[] {
  const causas: CausaPjud[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  const stripTags = (s: string) =>
    s
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(stripTags(cellMatch[1]));
    }
    if (cells.length < 3) continue;
    const joined = cells.join(" ");
    if (!/\d{1,6}\s*[-–/]\s*\d{2,4}/.test(joined)) continue;

    const rolMatch = joined.match(/\b(\d{1,6}\s*[-–]\s*\d{2,4})\b/);
    const tribunalGuess = cells.find((c) =>
      /juzgado|corte|tribunal/i.test(c),
    );
    causas.push({
      tribunal: tribunalGuess ?? "Tribunal no identificado",
      rol: rolMatch?.[1]?.replace(/\s+/g, ""),
      caratulado: cells.find((c) => /\bvs\.?\b|\/|con\b/i.test(c)) ?? cells[0],
      estado: cells.find((c) => /terminad|vigente|activ/i.test(c)),
      url: baseUrl,
      integrity: "candidate",
      warning:
        "Dato obtenido por scraping (workaround CAPTCHA) de Oficina Judicial Virtual. PJUD no valida este acceso; el estado puede cambiar sin previo aviso. Verifica en el portal oficial.",
    });
  }
  return causas;
}

async function submitSearchForm(
  session: PjudSession,
  formValues: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ html: string; url: string }> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      locale: "es-CL",
    });
    await context.addCookies(session.cookies);
    const page = await context.newPage();
    try {
      await page.goto(OJV_SEARCH_URL, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
    } catch (error) {
      throw new PjudCausasTimeoutError(
        `Timeout navegando a Oficina Judicial Virtual: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const captchaStillShown =
      (await page
        .locator('img[src*="captcha"], img[alt*="captcha" i]')
        .count()) > 0;
    if (captchaStillShown) {
      invalidateSession();
      throw new PjudCausasCaptchaError(
        "La sesión reutilizada ya no es válida (CAPTCHA reapareció); reintenta para forzar un nuevo solve.",
      );
    }

    for (const [selector, value] of Object.entries(formValues)) {
      const field = page.locator(selector);
      if ((await field.count()) === 0) continue;
      await field.fill(value).catch(() => undefined);
    }

    const submitButton = page.locator(
      'button[type="submit"], input[type="submit"]',
    );
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 })
        .catch(() => undefined),
      submitButton.first().click().catch(() => undefined),
    ]);

    const html = await page.content();
    return { html, url: page.url() };
  } finally {
    await browser.close();
  }
}

async function runSearchWithSession(
  formValues: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ html: string; url: string }> {
  const session = await getValidSession(signal);
  try {
    return await submitSearchForm(session, formValues, signal);
  } catch (error) {
    if (error instanceof PjudCausasCaptchaError) {
      const freshSession = await getValidSession(signal);
      return submitSearchForm(freshSession, formValues, signal);
    }
    throw error;
  }
}

/**
 * Honest degraded response used whenever the feature is disabled (kill
 * switch off, or no solver configured): never a silent/opaque failure, always
 * a portal_stub-equivalent pointing at the manual official flow.
 */
function degradedResponse(
  query: string,
  reason: string,
): CausaPjudSearchResponse {
  return {
    query,
    source: "causas",
    results: [],
    warnings: [
      reason,
      "Case-tracking automatizado no disponible: abre la Consulta Unificada de Causas y búscala manualmente.",
    ],
    searchUrls: { pjudConsultaUnificada: PJUD_CAUSAS_PORTAL_URL },
  };
}

function unavailabilityReason(): string | undefined {
  if (!causasEnabled()) {
    return "PJUD_CAUSAS_ENABLED != 1: case-tracking automatizado deshabilitado (kill switch).";
  }
  if (!captchaSolverConfigured()) {
    return "CAPTCHA_SOLVER_PROVIDER/CAPTCHA_SOLVER_API_KEY no configurados: no se puede resolver el CAPTCHA de PJUD.";
  }
  return undefined;
}

/**
 * buscar_causa_pjud: search Oficina Judicial Virtual's Consulta Unificada by
 * RUT or nombre de litigante. Always integrity="candidate" — see module
 * docstring and docs/pjud-casetracking-solution.md §8.
 */
export async function buscarCausaPjud(
  rutONombre: string,
  tipoPersona: BuscarCausaTipoPersona,
  limite = 8,
  opts: BuscarCausaPjudOptions = {},
): Promise<CausaPjudSearchResponse> {
  const unavailable = unavailabilityReason();
  if (unavailable) return degradedResponse(rutONombre, unavailable);

  const cacheKey = `pjudCausas:buscar:${tipoPersona}:${rutONombre.trim().toLowerCase()}`;
  return pjudCauseCache.getOrSet(cacheKey, () =>
    withUpstreamLimit(OJV_SEARCH_URL, async () => {
      const isRut = /^[\d.]{7,11}-[\dkK]$/.test(rutONombre.trim());
      const formValues: Record<string, string> = isRut
        ? { 'input[name*="rut" i]': rutONombre.trim() }
        : { 'input[name*="nombre" i], input[name*="litigante" i]': rutONombre.trim() };
      if (opts.competencia) {
        formValues['select[name*="competencia" i]'] = opts.competencia;
      }

      const { html, url } = await runSearchWithSession(formValues, opts.signal);
      const causas = parseCausasFromHtml(html, url).slice(0, limite);
      if (causas.length === 0) {
        throw new PjudCausasNoResultsError(
          `Sin causas encontradas para "${rutONombre}" en Consulta Unificada.`,
        );
      }
      return {
        query: rutONombre,
        source: "causas" as const,
        results: causas,
        warnings: [
          "Datos scrapeados vía workaround CAPTCHA (no es una API oficial de PJUD). Verifica siempre en el portal antes de actuar.",
        ],
        searchUrls: { pjudConsultaUnificada: PJUD_CAUSAS_PORTAL_URL },
      };
    }),
  );
}

/**
 * obtener_causa_pjud: look up a single case by ROL/RIT/RUC. Returns the same
 * candidate-integrity shape as buscarCausaPjud, including movimientos when
 * the detail page exposes them.
 */
export async function obtenerCausaPjud(
  rolORit: string,
  opts: ObtenerCausaPjudOptions = {},
): Promise<CausaPjudSearchResponse> {
  const unavailable = unavailabilityReason();
  if (unavailable) return degradedResponse(rolORit, unavailable);

  const cacheKey = `pjudCausas:obtener:${(opts.tribunal ?? "").toLowerCase()}:${rolORit.trim().toLowerCase()}`;
  return pjudCauseCache.getOrSet(cacheKey, () =>
    withUpstreamLimit(OJV_SEARCH_URL, async () => {
      const formValues: Record<string, string> = {
        'input[name*="rol" i], input[name*="rit" i], input[name*="ruc" i]':
          rolORit.trim(),
      };
      if (opts.tribunal) {
        formValues['select[name*="tribunal" i]'] = opts.tribunal;
      }

      const { html, url } = await runSearchWithSession(formValues, opts.signal);
      const causas = parseCausasFromHtml(html, url);
      if (causas.length === 0) {
        throw new PjudCausasNoResultsError(
          `Causa "${rolORit}" no encontrada en Consulta Unificada.`,
        );
      }
      return {
        query: rolORit,
        source: "causas" as const,
        results: causas.slice(0, 1),
        warnings: [
          "Datos scrapeados vía workaround CAPTCHA (no es una API oficial de PJUD). Verifica siempre en el portal antes de actuar.",
        ],
        searchUrls: { pjudConsultaUnificada: PJUD_CAUSAS_PORTAL_URL },
      };
    }),
  );
}

