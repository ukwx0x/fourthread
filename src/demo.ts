/**
 * Offline scripted demo: mock adapters, two "sessions". Proves the vertical
 * slice without any live model: 4 bots respond in order, thread + memory
 * survive a close/reopen cycle, bot memory stays isolated.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, writeDefaultConfig, loadConfig } from "./config.js";
import { ThreadStore } from "./store.js";
import { MemoryManager } from "./memory.js";
import { BotLoop } from "./loop.js";
import { MockAdapter, type Adapter } from "./adapter.js";

function adaptersFor(ids: string[], models: Record<string, string>): Map<string, Adapter> {
  const m = new Map<string, Adapter>();
  for (const id of ids) {
    m.set(id, new MockAdapter({
      endpoint: "mock",
      model: models[id],
      temperature: 0.3,
      maxTokens: 512,
    }, id));
  }
  return m;
}

const cwd = mkdtempSync(join(tmpdir(), "fourthread-demo-"));
writeDefaultConfig(cwd);
const cfg = loadConfig(cwd);
const models = Object.fromEntries(Object.entries(cfg.bots).map(([id, b]) => [id, b.model]));

// --- Session 1 ---
{
  const store = new ThreadStore(join(cwd, ".fourthread/thread.sqlite"));
  const memory = new MemoryManager(cwd, store);
  const loop = new BotLoop({ store, memory, adapters: adaptersFor(cfg.order, models), order: cfg.order });
  memory.addFact("chief", "The project codename is LANTERN.");
  memory.addFact("shared", "The user prefers concise answers.");
  console.log("== session 1: user asks, 4 bots respond ==");
  const turns = await loop.userTurn("plan a todo app");
  for (const t of turns.filter((x) => x.role === "assistant")) {
    console.log(`[${t.bot} · ${t.model}] ${t.content}`);
  }
  store.close();
}

// --- Session 2: "restart" (new process view, same files) ---
{
  const store = new ThreadStore(join(cwd, ".fourthread/thread.sqlite"));
  const memory = new MemoryManager(cwd, store);
  const thread = store.loadThread();
  console.log(`\n== session 2: after restart, loadThread() returns ${thread.length} turns in order ==`);
  console.log(`chief sees private fact: ${memory.systemPromptFor("chief", cfg.order).includes("codename is LANTERN")}`);
  console.log(`specialist_a sees chief's fact: ${memory.systemPromptFor("specialist_a", cfg.order).includes("codename is LANTERN")}`);
  console.log(`specialist_a sees shared fact: ${memory.systemPromptFor("specialist_a", cfg.order).includes("prefers concise answers")}`);
  store.close();
}
console.log(`\ndemo workspace: ${cwd}`);
