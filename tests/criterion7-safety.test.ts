/**
 * Criterion 7: safety defaults sensible; editing the config changes
 * require_approval_for behavior without code changes.
 * (Interactive prompt wiring lives in the CLI; the tool-approval decision
 * itself is verified here purely from config.)
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, loadConfig, requiresApproval, writeDefaultConfig } from "../src/config.js";

describe("criterion 7 — configurable safety with sensible defaults", () => {
  it("default config approves nothing interactive except the default shell/file_delete", () => {
    const cfg = defaultConfig();
    expect(cfg.safety.allow_network_tools).toBe(true);
    expect(requiresApproval(cfg, "shell")).toBe(true);
    expect(requiresApproval(cfg, "file_delete")).toBe(true);
    expect(requiresApproval(cfg, "web_search")).toBe(false);
  });

  it("editing fourthread.yaml changes approval behavior with no code change", () => {
    const dir = mkdtempSync(join(tmpdir(), "ft-c7-"));
    writeDefaultConfig(dir);
    expect(requiresApproval(loadConfig(dir), "web_fetch")).toBe(false);

    writeFileSync(
      join(dir, "fourthread.yaml"),
      `bots:
  chief: { endpoint: "http://localhost:11434/v1", model: "a" }
  specialist_a: { endpoint: "http://localhost:11434/v1", model: "b" }
  specialist_b: { endpoint: "http://localhost:11434/v1", model: "c" }
  specialist_c: { endpoint: "http://localhost:11434/v1", model: "d" }
safety:
  allow_network_tools: true
  require_approval_for: [shell, web_fetch]
  max_turn_tokens: 4096
`
    );
    const cfg = loadConfig(dir);
    expect(requiresApproval(cfg, "web_fetch")).toBe(true);
    expect(requiresApproval(cfg, "file_delete")).toBe(false); // no longer listed
    expect(cfg.safety.max_turn_tokens).toBe(4096);
  });
});
