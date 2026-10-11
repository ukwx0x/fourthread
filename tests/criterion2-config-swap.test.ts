/**
 * Criterion 2 (offline-verifiable part): a model swap in config and a process
 * restart preserve all memory/context for the new-model bot's prompt.
 * The live "new model actually answers" half needs an Ollama/OpenAI endpoint
 * and is UNVERIFIED here (adapters are mocked by design).
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { ThreadStore } from "../src/store.js";
import { MemoryManager } from "../src/memory.js";

describe("criterion 2 — model swap preserves memory/context (offline part)", () => {
  it("after changing specialist model + reopening, memory is intact and model is the new one", () => {
    const dir = mkdtempSync(join(tmpdir(), "ft-c2-"));
    writeFileSync(
      join(dir, "fourthread.yaml"),
      `bots:
  chief: { endpoint: "http://localhost:11434/v1", model: "gpt-4o", temperature: 0.3 }
  specialist_a: { endpoint: "http://localhost:11434/v1", model: "gpt-4o", temperature: 0.2 }
  specialist_b: { endpoint: "http://localhost:11434/v1", model: "gpt-4o", temperature: 0.4 }
  specialist_c: { endpoint: "http://localhost:11434/v1", model: "gpt-4o", temperature: 0.1 }
safety: { allow_network_tools: true, require_approval_for: [shell], max_turn_tokens: 8192 }
`
    );
    const cfg1 = loadConfig(dir);
    expect(cfg1.bots.chief.model).toBe("gpt-4o");

    // session 1: chief stores a fact
    const s1 = new ThreadStore(join(dir, ".fourthread/thread.sqlite"));
    const m1 = new MemoryManager(dir, s1);
    m1.addFact("chief", "Release day is Friday.");
    s1.appendTurn({ ts: "2026-10-11T00:00:00Z", bot: "chief", role: "assistant", content: "noted", model: cfg1.bots.chief.model });
    s1.close();

    // swap chief's model to a local Ollama model
    writeFileSync(
      join(dir, "fourthread.yaml"),
      `bots:
  chief: { endpoint: "http://localhost:11434/v1", model: "llama3.1:70b", temperature: 0.3 }
  specialist_a: { endpoint: "http://localhost:11434/v1", model: "gpt-4o", temperature: 0.2 }
  specialist_b: { endpoint: "http://localhost:11434/v1", model: "gpt-4o", temperature: 0.4 }
  specialist_c: { endpoint: "http://localhost:11434/v1", model: "gpt-4o", temperature: 0.1 }
safety: { allow_network_tools: true, require_approval_for: [shell], max_turn_tokens: 8192 }
`
    );
    const cfg2 = loadConfig(dir); // "restart" with new config
    expect(cfg2.bots.chief.model).toBe("llama3.1:70b");

    const s2 = new ThreadStore(join(dir, ".fourthread/thread.sqlite"));
    const m2 = new MemoryManager(dir, s2);
    // memory + thread survive intact under the new model
    expect(m2.systemPromptFor("chief", cfg2.order)).toContain("Release day is Friday.");
    expect(s2.loadThread()).toHaveLength(1);
    // bot turns recorded after the swap carry the new model id
    const t = s2.appendTurn({ ts: "2026-10-11T01:00:00Z", bot: "chief", role: "assistant", content: "new model replies", model: cfg2.bots.chief.model });
    expect(t.model).toBe("llama3.1:70b");
    s2.close();
  });
});
