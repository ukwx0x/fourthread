/** Criterion 1: kill process mid-conversation -> restart -> loadThread returns every prior turn in order. */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThreadStore } from "../src/store.js";

describe("criterion 1 — session survives process restart", () => {
  it("returns all turns in order after close + reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "ft-c1-"));
    const db = join(dir, "thread.sqlite");

    const s1 = new ThreadStore(db);
    s1.appendTurn({ ts: "2026-10-11T00:00:00Z", bot: "user", role: "user", content: "hello", model: null });
    s1.appendTurn({ ts: "2026-10-11T00:00:01Z", bot: "chief", role: "assistant", content: "plan", model: "m1" });
    s1.appendTurn({ ts: "2026-10-11T00:00:02Z", bot: "specialist_a", role: "assistant", content: "done", model: "m2" });
    s1.close(); // simulates process exit / kill (WAL committed per append)

    const s2 = new ThreadStore(db); // fresh "process"
    const turns = s2.loadThread();
    expect(turns.map((t) => [t.bot, t.content])).toEqual([
      ["user", "hello"],
      ["chief", "plan"],
      ["specialist_a", "done"],
    ]);
    expect(turns.map((t) => t.id)).toEqual([1, 2, 3]);
    s2.close();
  });
});
