/**
 * Model adapters. OpenAICompatibleAdapter talks to any OpenAI-compatible
 * /chat/completions endpoint (Ollama, OpenAI, vLLM, ...). MockAdapter is the
 * offline stand-in used by tests and `npm run demo`.
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

export class OpenAICompatibleAdapter implements Adapter {
  constructor(public config: BotConfig) {}

  async chat(systemPrompt: string, thread: Turn[]): Promise<string> {
    const res = await fetch(`${this.config.endpoint}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.config.model,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        messages: toMessages(systemPrompt, thread),
      }),
    });
    if (!res.ok) {
      throw new Error(`${this.config.model} @ ${this.config.endpoint}: HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    return data.choices[0]?.message?.content ?? "";
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
