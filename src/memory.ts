/**
 * Memory layer.
 *  - ./MEMORY.md              — shared, prepended to every bot's system prompt
 *  - .fourthread/memory/<bot-id>.md — per-bot, prepended only to that bot's prompt
 * Both are append-only, deduped at write time (store-level + file-level).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { ThreadStore } from "./store.js";

const HEADER = "# fourthread memory\n\n";

export class MemoryManager {
  readonly memoryDir: string;
  private sharedPath: string;

  constructor(
    readonly cwd: string,
    private store: ThreadStore
  ) {
    this.memoryDir = join(cwd, ".fourthread", "memory");
    this.sharedPath = join(cwd, "MEMORY.md");
    mkdirSync(this.memoryDir, { recursive: true });
    if (!existsSync(this.sharedPath)) writeFileSync(this.sharedPath, HEADER);
  }

  sharedFacts(): string[] {
    return this.store.loadMemory("shared");
  }

  botFacts(botId: string): string[] {
    return this.store.loadMemory(botId);
  }

  /** Append a fact: persists into SQLite and the corresponding .md file. Returns false if duplicate. */
  addFact(target: "shared" | string, fact: string): boolean {
    const clean = fact.trim();
    if (!clean) return false;
    if (!this.store.saveMemory(target, clean)) return false;
    if (target === "shared") {
      appendFileSync(this.sharedPath, `- ${clean}\n`);
    } else {
      const p = this.botPath(target);
      if (!existsSync(p)) writeFileSync(p, HEADER);
      appendFileSync(p, `- ${clean}\n`);
    }
    return true;
  }

  private botPath(botId: string): string {
    return join(this.memoryDir, `${botId}.md`);
  }

  /** Rebuild the .md files from SQLite (source of truth after restart). */
  private hydrateFromStore(botIds: string[]): void {
    const write = (path: string, facts: string[]) => {
      writeFileSync(path, HEADER + facts.map((f) => `- ${f}\n`).join(""));
    };
    write(this.sharedPath, this.sharedFacts());
    for (const id of botIds) write(this.botPath(id), this.botFacts(id));
  }

  systemPromptFor(botId: string, botIds: string[]): string {
    // Files are a convenience mirror; SQLite is the source of truth.
    // On first run the files may not exist yet — rebuild them once.
    if (!existsSync(this.botPath(botId))) this.hydrateFromStore(botIds);
    const shared = this.sharedFacts();
    const own = this.botFacts(botId);
    const lines = [
      `You are ${botId}, one of ${botIds.length} bots in a fourthread workspace.`,
    ];
    if (shared.length) lines.push("Shared memory:", ...shared.map((f) => `- ${f}`));
    if (own.length) lines.push("Your private memory:", ...own.map((f) => `- ${f}`));
    return lines.join("\n");
  }
}
