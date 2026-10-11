/** Criterion 3: cd to a new dir -> fourthread creates MEMORY.md; add a fact; restart -> fact in system prompt. */
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDefaultConfig } from "../src/config.js";
import { ThreadStore } from "../src/store.js";
import { MemoryManager } from "../src/memory.js";

describe("criterion 3 — per-directory MEMORY.md created and loaded", () => {
  it("new dir gets MEMORY.md; fact added in session 1 appears in session 2 prompts", () => {
    const dir = mkdtempSync(join(tmpdir(), "ft-c3-"));
    writeDefaultConfig(dir);

    // session 1
    const s1 = new ThreadStore(join(dir, ".fourthread/thread.sqlite"));
    const m1 = new MemoryManager(dir, s1);
    expect(existsSync(join(dir, "MEMORY.md"))).toBe(true); // created by session start
    expect(m1.addFact("shared", "The workspace root is /srv/app.")).toBe(true);
    expect(m1.addFact("shared", "The workspace root is /srv/app.")).toBe(false); // deduped
    s1.close();

    // session 2 ("restart" in the same dir)
    const s2 = new ThreadStore(join(dir, ".fourthread/thread.sqlite"));
    const m2 = new MemoryManager(dir, s2);
    expect(m2.systemPromptFor("specialist_b", ["chief", "specialist_a", "specialist_b", "specialist_c"]))
      .toContain("The workspace root is /srv/app.");
    s2.close();
  });
});
