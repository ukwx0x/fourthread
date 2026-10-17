/**
 * The 4-bot loop: user turn -> Chief plans -> specialists execute in order ->
 * Chief summarizes. Every turn is appended to the shared thread immediately.
 *
 * Tools: if a bot's reply contains `@tool <name> {json}` lines, the loop
 * executes them, appends a visible tool-result turn, and calls the bot once
 * more so it can act on the results. Max 2 tool rounds per bot turn.
 */
import { ThreadStore } from "./store.js";
import { MemoryManager } from "./memory.js";
import type { Adapter } from "./adapter.js";
import { ToolRegistry, parseToolCalls } from "./tools.js";
import type { Turn } from "./schema.js";

export interface BotLoopOptions {
  store: ThreadStore;
  memory: MemoryManager;
  adapters: Map<string, Adapter>; // key: bot id; must contain `chief`
  order: string[]; // specialist order (chief implied first & last)
  tools?: ToolRegistry;
}

function now(): string {
  return new Date().toISOString();
}

const MAX_TOOL_ROUNDS = 2;

export class BotLoop {
  private opts: BotLoopOptions;
  constructor(opts: BotLoopOptions) {
    if (!opts.adapters.has("chief")) throw new Error("loop requires a `chief` bot");
    this.opts = opts;
  }

  private specialistOrder(): string[] {
    return this.opts.order.filter((id) => id !== "chief");
  }

  /** One model call + tool rounds. Returns the turns appended for it. */
  private async botRespond(botId: string, instruction: string): Promise<Turn[]> {
    const { store, memory, adapters, tools } = this.opts;
    const adapter = adapters.get(botId);
    if (!adapter) throw new Error(`no adapter for bot ${botId}`);
    store.appendTurn({
      ts: now(),
      bot: "system",
      role: "user",
      content: instruction,
      model: null,
    });
    const basePrompt = memory.systemPromptFor(botId, this.specialistOrder());
    const system = tools
      ? `${basePrompt}\n\nAvailable tools:\n${tools.describe()}\nInvoke a tool by emitting a line: @tool <name> <args-json>`
      : basePrompt;
    const turns: Turn[] = [];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const content = await adapter.chat(system, store.loadThread());
      turns.push(
        store.appendTurn({
          ts: now(),
          bot: botId,
          role: "assistant",
          content,
          model: adapter.config.model,
        })
      );
      if (!tools) break;
      const calls = parseToolCalls(content);
      if (!calls.length) break;
      const results: Record<string, unknown>[] = [];
      for (const call of calls) {
        try {
          results.push({ tool: call.name, result: await tools.runCall(call) });
        } catch (e) {
          results.push({ tool: call.name, error: (e as Error).message });
        }
      }
      turns.push(
        store.appendTurn({
          ts: now(),
          bot: "system",
          role: "user",
          content: `tool results for ${botId}: ${JSON.stringify(results)}`,
          model: null,
        })
      );
    }
    return turns;
  }

  /** Process one user message. Returns the 4+ turns appended for it. */
  async userTurn(userText: string): Promise<Turn[]> {
    const { store } = this.opts;
    const marked: Turn[] = [];
    store.appendTurn({ ts: now(), bot: "user", role: "user", content: userText, model: null });

    marked.push(
      ...(await this.botRespond(
        "chief",
        `Plan how to address the user's latest message. User said: ${userText}`
      ))
    );
    for (const id of this.specialistOrder()) {
      marked.push(
        ...(await this.botRespond(id, `Chief's plan is in the thread. Execute your specialist part now.`))
      );
    }
    marked.push(
      ...(await this.botRespond(
        "chief",
        `All specialists have responded. Summarize the result for the user in one short paragraph.`
      ))
    );
    return marked;
  }
}
