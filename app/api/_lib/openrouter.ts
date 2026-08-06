/**
 * Thin OpenRouter client for the Mizan AI endpoints.
 *
 * Design choices:
 *   - One user, one product. We do not port the full HustlIQ API client
 *     (concurrency semaphores, multi-model fallbacks, etc.). The shape of this
 *     helper is "just enough to fail visibly and well".
 *   - Direct fetch. nodejs_compat is already on (vite.config.ts:16), so the
 *     runtime has global fetch. No SDK needed.
 *   - Token-exhaustion retry: if the model stops because max_tokens was hit
 *     mid-message, retry once with doubled max_tokens. One retry. That's the
 *     one robustness pattern worth keeping from the HustlIQ client.
 *   - Visible failure: every error path returns a typed error the route can
 *     pass to the UI. No silent fallback to "looks like AI" keyword logic.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

export type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type JsonSchema = Record<string, unknown>;

export type CompletionOptions = {
  messages: OpenRouterMessage[];
  /** Hard cap on output tokens. Caller picks per endpoint. */
  maxTokens: number;
  /** Optional structured-output schema (OpenAI-compatible json_schema). */
  jsonSchema?: { name: string; schema: JsonSchema };
  /** Temperature. Lower for arrangement, slightly higher for coach voice. */
  temperature?: number;
  /** Allows the route to label errors. */
  endpoint: string;
};

export type CompletionResult =
  | { ok: true; content: string; finishReason: string; retried: boolean }
  | { ok: false; error: string; status: number };

function missingKeyError(): CompletionResult {
  return {
    ok: false,
    status: 503,
    error:
      "OPENROUTER_API_KEY is not configured. Add it to .dev.vars (local) or run `wrangler secret put OPENROUTER_API_KEY` (prod).",
  };
}

async function callOpenRouter(
  apiKey: string,
  options: CompletionOptions,
  maxTokens: number,
): Promise<CompletionResult> {
  const body: Record<string, unknown> = {
    model: DEFAULT_MODEL,
    messages: options.messages,
    max_tokens: maxTokens,
    temperature: options.temperature ?? 0.6,
  };

  if (options.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: options.jsonSchema.name,
        strict: true,
        schema: options.jsonSchema.schema,
      },
    };
  }

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // OpenRouter ranks requests by these; harmless when blank.
        "HTTP-Referer": "https://mizan.local",
        "X-Title": "Mizan",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `Network error contacting OpenRouter (${options.endpoint}): ${
        err instanceof Error ? err.message : "unknown"
      }`,
    };
  }

  if (!response.ok) {
    const detail = await safeReadText(response);
    return {
      ok: false,
      status: response.status,
      error: `OpenRouter ${options.endpoint} call failed (${response.status}): ${truncate(detail, 280)}`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      status: 502,
      error: `OpenRouter ${options.endpoint} returned non-JSON.`,
    };
  }

  const choice = (payload as { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }> })?.choices?.[0];
  const content = choice?.message?.content ?? "";
  const finishReason = choice?.finish_reason ?? "unknown";

  // Token-exhaustion retry. If the model hit max_tokens mid-message, give it
  // one more shot with doubled budget — cheap insurance against truncated JSON.
  if ((!content || finishReason === "length") && maxTokens < 4096) {
    return { ok: false, status: 200, error: "retry", finishReason, content: "", retried: false } as unknown as CompletionResult;
  }

  if (!content) {
    return {
      ok: false,
      status: 502,
      error: `OpenRouter ${options.endpoint} returned an empty completion (finish_reason: ${finishReason}).`,
    };
  }

  return { ok: true, content, finishReason, retried: false };
}

export async function complete(env: unknown, options: CompletionOptions): Promise<CompletionResult> {
  const apiKey = (env as { OPENROUTER_API_KEY?: string } | undefined)?.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return missingKeyError();

  const first = await callOpenRouter(apiKey, options, options.maxTokens);
  if (first.ok) return first;

  // Retry only on token exhaustion. Network/HTTP errors fail immediately — we
  // do not want to bill the user twice for a flaky network.
  const looksLikeTruncation =
    "error" in first &&
    first.error === "retry";
  if (!looksLikeTruncation) return first;

  const retry = await callOpenRouter(apiKey, options, options.maxTokens * 2);
  if (retry.ok) return { ...retry, retried: true };
  return retry;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<no body>";
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/** Convenience wrapper for JSON-schema responses. Parses and surfaces shape errors. */
export async function completeJson<T>(
  env: unknown,
  options: CompletionOptions & { jsonSchema: { name: string; schema: JsonSchema } },
): Promise<{ ok: true; value: T; retried: boolean } | { ok: false; error: string; status: number }> {
  const result = await complete(env, options);
  if (!result.ok) return result;
  try {
    const parsed = JSON.parse(result.content) as T;
    return { ok: true, value: parsed, retried: result.retried };
  } catch {
    return {
      ok: false,
      status: 502,
      error: `OpenRouter ${options.endpoint} returned content that did not parse as JSON: ${truncate(result.content, 200)}`,
    };
  }
}
