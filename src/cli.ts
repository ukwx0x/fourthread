#!/usr/bin/env node
/**
 * fourthread CLI. `fourthread init` writes fourthread.yaml; `fourthread` starts
 * the REPL in the current directory. Context survives Ctrl+C / restart.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig, writeDefaultConfig, CONFIG_FILENAME } from "./config.js";
import { ThreadStore } from "./store.js";
import { MemoryManager } from "./memory.js";
import { BotLoop } from "./loop.js";
import { OpenAICompatibleAdapter } from "./adapter.js";

function makeLoop(cwd: string): { loop: BotLoop; close: () => void } {
  const cfg = loadConfig(cwd);
  const store = new ThreadStore(`${cwd}/.fourthread/thread.sqlite`);
  const memory = new MemoryManager(cwd, store);
  const adapters = new Map(
    Object.entries(cfg.bots).map(([id, botCfg]) => [id, new OpenAICompatibleAdapter(botCfg)])
  );
  return {
    loop: new BotLoop({ store, memory, adapters, order: cfg.order }),
    close: (): void => store.close(),
  };
}

async function main() {
  const cwd = process.cwd();
  const [, , cmd] = process.argv;

  if (cmd === "init") {
    console.log(`wrote ${writeDefaultConfig(cwd)}`);
    return;
  }
  if (cmd === "--help" || cmd === "-h") {
    console.log(`fourthread v0.1.0 — local-first 4-bot assistant
usage:
  fourthread init    create ./${CONFIG_FILENAME}
  fourthread         start the REPL (creates ./MEMORY.md + .fourthread/thread.sqlite)`);
    return;
  }

  const { loop, close } = makeLoop(cwd);
  const rl = createInterface({ input: stdin, output: stdout });
  console.log("fourthread REPL — Ctrl+C to exit. Context is saved after every turn.");
  for (;;) {
    let line: string | null;
    try {
      line = await rl.question("> ");
    } catch {
      break; // Ctrl+D
    }
    const text = line.trim();
    if (!text) continue;
    if (text === "exit" || text === "quit") break;
    try {
      const turns = await loop.userTurn(text);
      for (const t of turns.filter((x) => x.role === "assistant")) {
        console.log(`\n[${t.bot} · ${t.model}] ${t.content}`);
      }
    } catch (e) {
      console.log(`error: ${(e as Error).message}`);
    }
    console.log();
  }
  rl.close();
  close();
}

main();
