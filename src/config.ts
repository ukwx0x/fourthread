/**
 * fourthread.yaml config loading + validation.
 * Single file drives all 4 bots (endpoint/model/temperature/maxTokens) plus safety.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import YAML from "js-yaml";

export interface BotConfig {
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface SafetyConfig {
  allow_network_tools: boolean;
  require_approval_for: string[];
  max_turn_tokens: number;
}

export interface FourthreadConfig {
  bots: Record<string, BotConfig>;
  safety: SafetyConfig;
  order: string[]; // bot ids in turn order, chief first and last
}

export const CONFIG_FILENAME = "fourthread.yaml";

const DEFAULT_BOTS: Record<string, BotConfig> = {
  chief: { endpoint: "http://localhost:11434/v1", model: "llama3.1:70b", temperature: 0.3, maxTokens: 2048 },
  specialist_a: { endpoint: "http://localhost:11434/v1", model: "codellama:34b", temperature: 0.2, maxTokens: 2048 },
  specialist_b: { endpoint: "https://api.openai.com/v1", model: "gpt-4o", temperature: 0.4, maxTokens: 2048 },
  specialist_c: { endpoint: "http://localhost:11434/v1", model: "qwen2.5-coder:32b", temperature: 0.1, maxTokens: 2048 },
};

export function defaultConfig(): FourthreadConfig {
  return {
    bots: structuredClone(DEFAULT_BOTS),
    safety: {
      allow_network_tools: true,
      require_approval_for: ["shell", "file_delete"],
      max_turn_tokens: 8192,
    },
    order: ["chief", "specialist_a", "specialist_b", "specialist_c"],
  };
}

function fail(msg: string): never {
  throw new Error(`invalid ${CONFIG_FILENAME}: ${msg}`);
}

export function validateConfig(raw: unknown): FourthreadConfig {
  if (typeof raw !== "object" || raw === null) fail("config must be a mapping");
  const obj = raw as Record<string, unknown>;
  if (typeof obj.bots !== "object" || obj.bots === null) fail("missing `bots`");
  const bots: Record<string, BotConfig> = {};
  for (const [id, cfg] of Object.entries(obj.bots as Record<string, unknown>)) {
    const c = cfg as Record<string, unknown>;
    if (typeof c.endpoint !== "string") fail(`bots.${id}: endpoint must be a string`);
    if (typeof c.model !== "string") fail(`bots.${id}: model must be a string`);
    bots[id] = {
      endpoint: c.endpoint,
      model: c.model,
      temperature: typeof c.temperature === "number" ? c.temperature : 0.3,
      maxTokens: typeof c.maxTokens === "number" ? c.maxTokens : 2048,
    };
  }
  if (Object.keys(bots).length < 4) fail("need 4 bot entries (chief + 3 specialists)");
  if (!bots.chief) fail("missing `bots.chief`");

  const s = (obj.safety ?? {}) as Record<string, unknown>;
  const safety: SafetyConfig = {
    allow_network_tools: typeof s.allow_network_tools === "boolean" ? s.allow_network_tools : true,
    require_approval_for: Array.isArray(s.require_approval_for)
      ? (s.require_approval_for as unknown[]).filter((x): x is string => typeof x === "string")
      : ["shell", "file_delete"],
    max_turn_tokens: typeof s.max_turn_tokens === "number" ? s.max_turn_tokens : 8192,
  };
  return { bots, safety, order: Object.keys(bots) };
}

export function loadConfig(cwd: string): FourthreadConfig {
  const path = join(cwd, CONFIG_FILENAME);
  if (!existsSync(path)) fail(`no ${CONFIG_FILENAME} in ${cwd} — run \`fourthread init\``);
  return validateConfig(YAML.load(readFileSync(path, "utf8")));
}

export function writeDefaultConfig(cwd: string): string {
  const path = join(cwd, CONFIG_FILENAME);
  if (existsSync(path)) throw new Error(`${CONFIG_FILENAME} already exists`);
  const cfg = defaultConfig();
  const yaml = {
    bots: Object.fromEntries(
      Object.entries(cfg.bots).map(([id, b]) => [
        id,
        { endpoint: b.endpoint, model: b.model, temperature: b.temperature, maxTokens: b.maxTokens },
      ])
    ),
    safety: cfg.safety,
  };
  writeFileSync(path, YAML.dump(yaml, { lineWidth: 100 }));
  return path;
}

/** True if the named tool needs an interactive approval under this config. */
export function requiresApproval(cfg: FourthreadConfig, tool: string): boolean {
  return cfg.safety.require_approval_for.includes(tool);
}
