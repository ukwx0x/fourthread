/**
 * Minimal tool system: a tool is {name, description, schema (JSON-ish shape
 * for docs), run(args)}. The registry sandboxes every file tool to the
 * workspace root. Bots invoke tools by emitting lines of the form:
 *
 *   @tool toolname {"arg": "value"}
 *
 * The loop parses those lines, executes the tools, and appends the results
 * back into the shared thread so every bot can see them.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { isAbsolute, join, normalize, dirname, resolve } from "node:path";

export interface Tool {
  name: string;
  description: string;
  schema: Record<string, string>;
  run(args: Record<string, unknown>): Promise<unknown> | unknown;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** Extract `@tool name {json}` calls from model output (max 3 per reply). */
export function parseToolCalls(content: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const re = /@tool\s+([a-zA-Z0-9_.-]+)\s+(\{[^\n]*\})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) && calls.length < 3) {
    try {
      calls.push({ name: m[1], args: JSON.parse(m[2]) });
    } catch {
      // Malformed JSON in a tool line is ignored (never crashes the loop).
    }
  }
  return calls;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) throw new Error(`tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return [...this.tools.keys()].sort();
  }

  describe(): string {
    return this.names()
      .map((n) => {
        const t = this.tools.get(n)!;
        return `${n}(${Object.entries(t.schema).map(([k, v]) => `${k}: ${v}`).join(", ")}) - ${t.description}`;
      })
      .join("\n");
  }

  async runCall(call: ToolCall): Promise<unknown> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { error: `unknown tool: ${call.name}`, available: this.names() };
    }
    return tool.run(call.args);
  }
}

/** Every file path must resolve inside `root` (sandbox). */
export function safePath(root: string, p: unknown): string {
  if (typeof p !== "string" || !p.trim()) throw new Error("path must be a non-empty string");
  const candidate = resolve(isAbsolute(p) ? normalize(p) : join(root, normalize(p)));
  const rootAbs = resolve(root);
  if (candidate !== rootAbs && !candidate.startsWith(rootAbs + "/")) {
    throw new Error(`path escapes workspace sandbox: ${p}`);
  }
  return candidate;
}

export function defaultTools(root: string, memoryFile: string, memoryAppend: (text: string) => void): Tool[] {
  return [
    {
      name: "fs.read",
      description: "Read a file inside the workspace sandbox.",
      schema: { path: "string" },
      run({ path }) {
        return { content: readFileSync(safePath(root, path), "utf8") };
      },
    },
    {
      name: "fs.write",
      description: "Write (or create) a file inside the workspace sandbox.",
      schema: { path: "string", content: "string" },
      run({ path, content }) {
        if (typeof content !== "string") throw new Error("content must be a string");
        const abs = safePath(root, path);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content, "utf8");
        return { written: abs, bytes: Buffer.byteLength(content) };
      },
    },
    {
      name: "mem.append",
      description: "Append one fact/line to this bot's long-term memory.",
      schema: { text: "string" },
      run({ text }) {
        if (typeof text !== "string" || !text.trim()) throw new Error("text must be a non-empty string");
        memoryAppend(text.trim());
        return { memory: memoryFile };
      },
    },
  ];
}
