/** Criterion 6: bot memory is isolated and survives model swap + restart. */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, writeDefaultConfig } from "../src/config.js";
import { ThreadStore } from "../src/store.js";
import { MemoryManager } from "../src/memory.js";

const SWAPPED_YAML = `bots:
  chief: { endpoint: "http://localhost:11434/v1", model: "swapped-model", temperature: 0.3 }
  specialist_a: { endpoint: "http://localhost:11434/v1", model: "codellama:34b", temperature: 0.2 }
  specialist_b: { endpoint: "https://api.openai.com/v1", model: "gpt-4o", temperature: 0.4 }
  specialist_c: { endpoint: "http://localhost:11434/v1", model: "qwen2.5-coder:32b", temperature: 0.1 }
`;

describe("criterion 6 — bot memory isolated, survives model swap", () => {
  it("chief's fact stays in chief's prompt after restart + model swap, never in specialists'", () => {
    const dir = mkdtempSync(join(tmpdir(), "ft-c6-"));
    writeDefaultConfig(dir);
    const order = ["chief", "specialist_a", "specialist_b", "specialist_c"];

    // session 1: chief stores a private fact; a shared fact also added
    const s1 = new ThreadStore(join(dir, ".fourthread/thread.sqlite"));
    const m1 = new MemoryManager(dir, s1);
    m1.addFact("chief", "Chief-only: budget cap is 10k.");
    m1.addFact("shared", "Everyone: standup is at 09:00.");
    s1.close();

    // swap chief's model (simulating gpt-4o -> ollama) and "restart"
    writeFileSync(join(dir, "fourthread.yaml"), SWAPPED_YAML);
    const cfg = loadConfig(dir);
    expect(cfg.bots.chief.model).toBe("swapped-model");
    const s2 = new ThreadStore(join(dir, ".fourthread/thread.sqlite"));
    const m2 = new MemoryManager(dir, s2);

    const chiefPrompt = m2.systemPromptFor("chief", cfg.order);
    expect(chiefPrompt).toContain("Chief-only: budget cap is 10k.");
    expect(chiefPrompt).toContain("Everyone: standup is at 09:00.");

    for (const id of order.slice(1)) {
      const p = m2.systemPromptFor(id, cfg.order);
      expect(p).not.toContain("Chief-only: budget cap is 10k.");
      expect(p).toContain("Everyone: standup is at 09:00."); // shared memory reaches all
    }
    s2.close();
  });
});
