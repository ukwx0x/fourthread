/** M5: tool system (registry, sandbox, parse) + loop wiring, all offline. */
import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry, parseToolCalls, defaultTools, safePath } from "../src/tools.js";
import { BotLoop } from "../src/loop.js";
import { ScriptedAdapter } from "../src/adapter.js";
import { writeDefaultConfig } from "../src/config.js";
import { ThreadStore } from "../src/store.js";
import { MemoryManager } from "../src/memory.js";

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "ft-m5-"));
  writeDefaultConfig(dir);
  const store = new ThreadStore(join(dir, ".fourthread/thread.sqlite"));
  const memory = new MemoryManager(dir, store);
  return { dir, store, memory };
}

const cfg = (model: string) => ({ model, endpoint: "offline", temperature: 0, maxTokens: 1 });

describe("parseToolCalls", () => {
  it("parses @tool lines with JSON args, skips malformed ones, caps at 3", () => {
    const content = [
      "ok @tool fs.read {\"path\":\"README.md\"}",
      "@tool broken {not json",
      "more prose",
      "@tool fs.write {\"path\":\"x.txt\",\"content\":\"hi\"}",
    ].join("\n");
    const calls = parseToolCalls(content);
    expect(calls).toEqual([
      { name: "fs.read", args: { path: "README.md" } },
      { name: "fs.write", args: { path: "x.txt", content: "hi" } },
    ]);
  });
});

describe("safePath sandbox", () => {
  it("rejects absolute paths outside root and traversal escapes", () => {
    const root = tmpdir();
    expect(() => safePath(join(root, "w"), "../../etc/passwd")).toThrow(/escapes/);
    expect(() => safePath(join(root, "w"), "/etc/passwd")).toThrow(/escapes/);
    expect(safePath(join(root, "w"), "sub/file.txt")).toContain("sub/file.txt");
  });
});

describe("defaultTools", () => {
  it("fs.write + fs.read roundtrip inside sandbox", async () => {
    const { dir, memory } = workspace();
    const reg = new ToolRegistry();
    for (const t of defaultTools(dir, "MEMORY.md", (x) => memory.addFact("shared", x))) reg.register(t);
    const r1 = (await reg.runCall({ name: "fs.write", args: { path: "notes/a.txt", content: "hello" } })) as { written: string };
    expect(existsSync(join(dir, "notes/a.txt"))).toBe(true);
    expect(readFileSync(r1.written, "utf8")).toBe("hello");
    const r2 = (await reg.runCall({ name: "fs.read", args: { path: "notes/a.txt" } })) as { content: string };
    expect(r2.content).toBe("hello");
  });

  it("mem.append lands in shared memory via addFact", async () => {
    const { dir, store, memory } = workspace();
    const reg = new ToolRegistry();
    for (const t of defaultTools(dir, join(dir, "MEMORY.md"), (x) => memory.addFact("shared", x))) reg.register(t);
    await reg.runCall({ name: "mem.append", args: { text: "M5 fact from tool" } });
    const store2 = store;
    expect(store2.loadMemory("shared")).toContain("M5 fact from tool");
  });

  it("unknown tool returns an error result, not a crash", async () => {
    const reg = new ToolRegistry();
    const r = (await reg.runCall({ name: "nope", args: {} })) as { error: string };
    expect(r.error).toMatch(/unknown tool/);
  });

  it("describe() lists registered tools with schema and description", () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "fs.read",
      description: "Read a file.",
      schema: { path: "string" },
      run: () => "",
    });
    expect(reg.describe()).toContain("fs.read(path: string) - Read a file.");
  });
});

describe("BotLoop tool wiring", () => {
  it("a bot emitting @tool gets results back in the thread and acts on them", async () => {
    const { dir, store, memory } = workspace();
    const reg = new ToolRegistry();
    for (const t of defaultTools(dir, "MEMORY.md", (x) => memory.addFact("shared", x))) reg.register(t);

    const ccfg = { endpoint: "offline", model: "chief-model", temperature: 0, maxTokens: 8 };
    const scfg = { endpoint: "offline", model: "spec-model", temperature: 0, maxTokens: 8 };

    const chief = new ScriptedAdapter(ccfg, "chief", [
      "checking @tool fs.write {\"path\":\"t.txt\",\"content\":\"m5\"}",
      "confirming @tool fs.read {\"path\":\"t.txt\"}",
      "done: file content confirmed",
    ]);
    const spec = new ScriptedAdapter(scfg, "specialist_x", [
      "worked, @tool mem.append {\"text\":\"spec used tool\"} first reply, awaiting results",
      "did the specialist part with tools",
    ]);
    const adapters = new Map<string, ScriptedAdapter>([
      ["chief", chief],
      ["specialist_a", spec],
      ["specialist_b", spec],
      ["specialist_c", spec],
    ]);

    const loop = new BotLoop({ store, memory, adapters, order: ["chief", "specialist_a", "specialist_b", "specialist_c"], tools: reg });
    await loop.userTurn("use tools");

    const thread = store.loadThread();
    const toolResultTurns = thread.filter((t) => t.content.startsWith("tool results for"));
    expect(toolResultTurns.length).toBeGreaterThanOrEqual(2); // chief 2 rounds + spec 1 round
    expect(toolResultTurns.some((t) => t.content.includes('"tool":"fs.read"'))).toBe(true);
    expect(thread.some((t) => t.bot === "chief" && t.content.includes("done: file content"))).toBe(true);
    expect(store.loadMemory("shared")).toContain("spec used tool");
  });
});
