/**
 * The 4-bot loop: user turn -> Chief plans -> specialists execute in order ->
 * Chief summarizes. Every turn is appended to the shared thread immediately.
 */
import { ThreadStore } from "./store.js";
import { MemoryManager } from "./memory.js";
import type { Adapter } from "./adapter.js";
import type { Turn } from "./schema.js";

export interface BotLoopOptions {
  store: ThreadStore;
  memory: MemoryManager;
  adapters: Map<string, Adapter>; // key: bot id; must contain `chief`
  order: string[]; // specialist order (chief implied first & last)
}

function now(): string {
  return new Date().toISOString();
}

export class BotLoop {
  private opts: BotLoopOptions;
  constructor(opts: BotLoopOptions) {
    if (!opts.adapters.has("chief")) throw new Error("loop requires a `chief` bot");
    this.opts = opts;
  }

  private specialistOrder(): string[] {
    return this.opts.order.filter((id) => id !== "chief");
  }

  private async botRespond(botId: string, instruction: string): Promise<Turn> {
    const { store, memory, adapters, order } = this.opts;
    const adapter = adapters.get(botId);
    if (!adapter) throw new Error(`no adapter for bot ${botId}`);
    store.appendTurn({
      ts: now(),
      bot: "system",
      role: "user",
      content: instruction,
      model: null,
    });
    const system = memory.systemPromptFor(botId, order);
    const content = await adapter.chat(system, store.loadThread());
    return store.appendTurn({
      ts: now(),
      bot: botId,
      role: "assistant",
      content,
      model: adapter.config.model,
    });
  }

  /** Process one user message. Returns the 4+ turns appended for it. */
  async userTurn(userText: string): Promise<Turn[]> {
    const { store } = this.opts;
    const marked: Turn[] = [];
    store.appendTurn({ ts: now(), bot: "user", role: "user", content: userText, model: null });

    marked.push(
      await this.botRespond(
        "chief",
        `Plan how to address the user's latest message. User said: ${userText}`
      )
    );
    for (const id of this.specialistOrder()) {
      marked.push(
        await this.botRespond(
          id,
          `Chief's plan is in the thread. Execute your specialist part now.`
        )
      );
    }
    marked.push(
      await this.botRespond(
        "chief",
        `All specialists have responded. Summarize the result for the user in one short paragraph.`
      )
    );
    return marked;
  }
}
