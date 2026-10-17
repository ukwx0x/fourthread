/**
 * Model adapters. OpenAICompatibleAdapter talks to any OpenAI-compatible
 * /chat/completions endpoint (Ollama, OpenAI, vLLM, ...) with per-call timeout
 * and retry with backoff on transient failures (5xx, 429, network errors).
 * MockAdapter is the offline stand-in used by tests and `npm run demo`.
 */
import type { BotConfig } from "./config.js";
import type { Turn } from "./schema.js";

export interface Adapter {
  config: BotConfig;
  chat(systemPrompt: string, thread: Turn[]): Promise<string>;
}

/** Convert the shared thread into OpenAI messages format. */
export function toMessages(systemPrompt: string, thread: Turn[]) {
  const msgs = [
    { role: "system" as const, content: systemPrompt },
    ...thread.map((t) => ({
      role: t.role as "user" | "assistant",
      content: t.role === "assistant" ? `[${t.bot}] ${t.content}` : t.content,
    })),
  ];
  return msgs;
}

export interface AdapterOptions {
  /** Max attempts (default 3: 2 retries). */
  retries?: number;
  /** Per-request timeout in ms (default 30000). */
  timeoutMs?: number;
  /** Base backoff in ms (default 250; doubles each retry). */
  backoffMs?: number;
  /** Injectable fetch for tests (defaults to globalThis.fetch). */
  fetchImpl?: typeof fetch;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class OpenAICompatibleAdapter implements Adapter {
  private opts: Required<Pick<AdapterOptions, "retries" | "timeoutMs" | "backoffMs">> & {
    fetchImpl: typeof fetch;
  };

  constructor(
    public config: BotConfig,
    opts: AdapterOptions = {}
  ) {
    this.opts = {
      retries: opts.retries ?? 3,
      timeoutMs: opts.timeoutMs ?? 30_000,
      backoffMs: opts.backoffMs ?? 250,
      fetchImpl: opts.fetchImpl ?? ((u, i) => fetch(u, i) as Promise<Response>),
    };
  }

  async chat(systemPrompt: string, thread: Turn[]): Promise<string> {
    const body = JSON.stringify({
      model: this.config.model,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      stream: false,
      messages: toMessages(systemPrompt, thread),
    });

    let lastErr: unknown;
    for (let attempt = 1, wait = this.opts.backoffMs; attempt <= this.opts.retries; attempt++, wait *= 2) {
      try {
        const res = await this.opts.fetchImpl(`${this.config.endpoint}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(this.opts.timeoutMs),
          body,
        });
        if (!res.ok) {
          const err = new Error(
            `${this.config.model} @ ${this.config.endpoint}: HTTP ${res.status}`
          ) as Error & { status?: number };
          err.status = res.status;
          if (RETRYABLE_STATUS.has(res.status) && attempt < this.opts.retries) {
            lastErr = err;
            await sleep(wait);
            continue;
          }
          throw err;
        }
        const data = (await res.json()) as { choices: { message: { content: string } }[] };
        return data.choices[0]?.message?.content ?? "";
      } catch (e) {
        // Transient network/abort failures retry; throw again at the last attempt.
        if (attempt < this.opts.retries && !(e as { status?: number }).status) {
          lastErr = e;
          await sleep(wait);
          continue;
        }
        throw e;
      }
    }
    throw lastErr ?? new Error("model call failed");
  }
}

/**
 * Offline adapter for tests/demo: echoes a deterministic reply that names the
 * bot, its model, and the latest user message. Also records every call.
 */
export class MockAdapter implements Adapter {
  calls: { systemPrompt: string; thread: Turn[] }[] = [];
  constructor(
    public config: BotConfig,
    private botId: string
  ) {}

  async chat(systemPrompt: string, thread: Turn[]): Promise<string> {
    this.calls.push({ systemPrompt, thread });
    const lastUser = [...thread].reverse().find((t) => t.role === "user");
    return `[${this.botId}|${this.config.model}] ${lastUser?.content ?? "(no user turn)"}`;
  }
}

/**
 * Scriptable offline adapter: returns queued replies in order, optionally
 * emitting a tool call line (`@tool <name> <json>`) before its final reply.
 * Used to test the tool system without any network.
 */
export class ScriptedAdapter implements Adapter {
  calls: { systemPrompt: string; thread: Turn[] }[] = [];
  private idx = 0;
  constructor(
    public config: BotConfig,
    private botId: string,
    private replies: string[]
  ) {}

  async chat(systemPrompt: string, thread: Turn[]): Promise<string> {
    this.calls.push({ systemPrompt, thread });
    const reply = this.replies[Math.min(this.idx++, this.replies.length - 1)];
    return reply.replace(/\$BOT/g, this.botId).replace(/\$MODEL/g, this.config.model);
  }
}
