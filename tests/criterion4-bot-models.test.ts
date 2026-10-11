/** Criterion 4: 4 distinct model values in config -> each bot uses its assigned model. */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { ThreadStore } from "../src/store.js";
import { MemoryManager } from "../src/memory.js";
import { BotLoop } from "../src/loop.js";
import { MockAdapter, type Adapter } from "../src/adapter.js";

describe("criterion 4 — 4-bot config drives 4 different models", () => {
  it("one turn produces 4 bot responses, each recorded under its configured model", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ft-c4-"));
    writeFileSync(
      join(dir, "fourthread.yaml"),
      `bots:
  chief: { endpoint: "http://localhost:11434/v1", model: "llama3.1:70b", temperature: 0.3 }
  specialist_a: { endpoint: "http://localhost:11434/v1", model: "codellama:34b", temperature: 0.2 }
  specialist_b: { endpoint: "https://api.openai.com/v1", model: "gpt-4o", temperature: 0.4 }
  specialist_c: { endpoint: "http://localhost:11434/v1", model: "qwen2.5-coder:32b", temperature: 0.1 }
`
    );
    const cfg = loadConfig(dir);
    const store = new ThreadStore(join(dir, ".fourthread/thread.sqlite"));
    const memory = new MemoryManager(dir, store);
    const adapters = new Map<string, Adapter>(
      cfg.order.map((id) => [id, new MockAdapter(cfg.bots[id], id)])
    );
    const loop = new BotLoop({ store, memory, adapters, order: cfg.order });

    await loop.userTurn("plan a todo app");
    const assistantTurns = store.loadThread().filter((t) => t.role === "assistant");

    // chief appears twice (plan + summary); each specialist once
    expect(assistantTurns.map((t) => t.bot)).toEqual([
      "chief", "specialist_a", "specialist_b", "specialist_c", "chief",
    ]);
    expect(assistantTurns.map((t) => t.model)).toEqual([
      "llama3.1:70b", "codellama:34b", "gpt-4o", "qwen2.5-coder:32b", "llama3.1:70b",
    ]);
    const distinct = new Set(assistantTurns.map((t) => t.model));
    expect(distinct.size).toBe(4);
    store.close();
  });
});
