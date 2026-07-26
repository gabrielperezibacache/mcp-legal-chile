/**
 * Thin REST client for image-CAPTCHA solving services (2Captcha / CapSolver).
 */

export type CaptchaSolverProvider = "2captcha" | "capsolver";

export class CaptchaSolverConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptchaSolverConfigError";
  }
}

export class CaptchaSolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptchaSolveError";
  }
}

function providerFromEnv(): CaptchaSolverProvider | undefined {
  const raw = process.env.CAPTCHA_SOLVER_PROVIDER?.trim().toLowerCase();
  if (raw === "2captcha" || raw === "capsolver") return raw;
  return undefined;
}

function apiKeyFromEnv(): string | undefined {
  return process.env.CAPTCHA_SOLVER_API_KEY?.trim() || undefined;
}

export function captchaSolverConfigured(): boolean {
  return Boolean(providerFromEnv() && apiKeyFromEnv());
}

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = Number(process.env.CAPTCHA_SOLVE_TIMEOUT_MS ?? 120_000);

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

interface TwoCaptchaInResponse {
  status: 0 | 1;
  request: string;
}

interface TwoCaptchaResResponse {
  status: 0 | 1;
  request: string;
}

async function solveWith2Captcha(
  imageBase64: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const submit = await fetch("https://2captcha.com/in.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: apiKey,
      method: "base64",
      body: imageBase64,
      json: 1,
    }),
    signal,
  });
  const submitJson = (await submit.json()) as TwoCaptchaInResponse;
  if (submitJson.status !== 1) {
    throw new CaptchaSolveError(`2Captcha submit falló: ${submitJson.request}`);
  }
  const captchaId = submitJson.request;

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const poll = await fetch(
      `https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=get&id=${encodeURIComponent(captchaId)}&json=1`,
      { signal },
    );
    const pollJson = (await poll.json()) as TwoCaptchaResResponse;
    if (pollJson.status === 1) {
      return pollJson.request;
    }
    if (pollJson.request !== "CAPCHA_NOT_READY") {
      throw new CaptchaSolveError(
        `2Captcha resolvió con error: ${pollJson.request}`,
      );
    }
  }
  throw new CaptchaSolveError(
    `2Captcha no respondió dentro de ${POLL_TIMEOUT_MS}ms (id ${captchaId}).`,
  );
}

interface CapSolverCreateTaskResponse {
  errorId: number;
  errorDescription?: string;
  taskId?: string;
}

interface CapSolverTaskResultResponse {
  errorId: number;
  errorDescription?: string;
  status: "processing" | "ready" | "failed";
  solution?: { text: string };
}

async function solveWithCapSolver(
  imageBase64: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const create = await fetch("https://api.capsolver.com/createTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: apiKey,
      task: { type: "ImageToTextTask", body: imageBase64 },
    }),
    signal,
  });
  const createJson = (await create.json()) as CapSolverCreateTaskResponse;
  if (createJson.errorId !== 0 || !createJson.taskId) {
    throw new CaptchaSolveError(
      `CapSolver createTask falló: ${createJson.errorDescription ?? createJson.errorId}`,
    );
  }
  const taskId = createJson.taskId;

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const poll = await fetch("https://api.capsolver.com/getTaskResult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, taskId }),
      signal,
    });
    const pollJson = (await poll.json()) as CapSolverTaskResultResponse;
    if (pollJson.errorId !== 0) {
      throw new CaptchaSolveError(
        `CapSolver getTaskResult falló: ${pollJson.errorDescription ?? pollJson.errorId}`,
      );
    }
    if (pollJson.status === "ready" && pollJson.solution) {
      return pollJson.solution.text;
    }
    if (pollJson.status === "failed") {
      throw new CaptchaSolveError("CapSolver marcó la tarea como failed.");
    }
  }
  throw new CaptchaSolveError(
    `CapSolver no respondió dentro de ${POLL_TIMEOUT_MS}ms (task ${taskId}).`,
  );
}

/**
 * Solve an image CAPTCHA using the configured provider.
 * Throws CaptchaSolverConfigError if CAPTCHA_SOLVER_PROVIDER/API_KEY are unset
 * (callers should catch this and fall back to a portal_stub — never silently
 * skip the CAPTCHA).
 */
export async function solveImageCaptcha(
  imageBase64: string,
  signal?: AbortSignal,
): Promise<string> {
  const provider = providerFromEnv();
  const apiKey = apiKeyFromEnv();
  if (!provider || !apiKey) {
    throw new CaptchaSolverConfigError(
      "CAPTCHA_SOLVER_PROVIDER y CAPTCHA_SOLVER_API_KEY no están configurados.",
    );
  }
  if (provider === "2captcha") {
    return solveWith2Captcha(imageBase64, apiKey, signal);
  }
  return solveWithCapSolver(imageBase64, apiKey, signal);
}
