/** Criterion 5: export thread JSON -> import into a fresh store -> identical turn sequence. */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThreadStore } from "../src/store.js";
import { isCheckpointV1 } from "../src/schema.js";

describe("criterion 5 — single-thread context fully replayable", () => {
  it("imported checkpoint reproduces the identical turn sequence", () => {
    const src = new ThreadStore(join(mkdtempSync(join(tmpdir(), "ft-c5a-")), "t.sqlite"));
    src.appendTurn({ ts: "2026-10-11T00:00:00Z", bot: "user", role: "user", content: "hi", model: null });
    src.appendTurn({ ts: "2026-10-11T00:00:01Z", bot: "chief", role: "assistant", content: "plan", model: "m1" });
    src.appendTurn({ ts: "2026-10-11T00:00:02Z", bot: "specialist_a", role: "assistant", content: "done", model: "m2" });
    const exported = src.exportCheckpoint();
    src.close();
    expect(isCheckpointV1(exported)).toBe(true);

    // "another machine": serialize to JSON and back
    const file = join(mkdtempSync(join(tmpdir(), "ft-c5json-")), "checkpoint_v1.json");
    writeFileSync(file, JSON.stringify(exported, null, 2));
    const roundTripped = JSON.parse(readFileSync(file, "utf8"));
    expect(isCheckpointV1(roundTripped)).toBe(true);

    const dst = new ThreadStore(join(mkdtempSync(join(tmpdir(), "ft-c5b-")), "t.sqlite"));
    dst.importCheckpoint(roundTripped);
    const turns = dst.loadThread();
    expect(turns).toEqual(exported.turns);
    dst.close();
  });
});
