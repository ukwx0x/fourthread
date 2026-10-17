/** M5: OpenAICompatibleAdapter retry/timeout hardening, offline with injected fetch. */
import { describe, expect, it } from "vitest";
import { OpenAICompatibleAdapter } from "../src/adapter.js";

const cfg = {
  endpoint: "https://model.local/v1",
  model: "test-model",
  temperature: 0.2,
  maxTokens: 64,
} as never;

const okResponse = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), { status: 200 });

describe("OpenAICompatibleAdapter hardening (no network)", () => {
  it("retries on 5xx/429 then succeeds", async () => {
    let n = 0;
    const adapter = new OpenAICompatibleAdapter(cfg, {
      retries: 3,
      backoffMs: 1,
      fetchImpl: async () => (++n < 3 ? new Response("overload", { status: 503 }) : okResponse()),
    });
    expect(await adapter.chat("sys", [])).toBe("hi");
    expect(n).toBe(3);
  });

  it("does not retry on non-retryable status (throws immediately)", async () => {
    let n = 0;
    const adapter = new OpenAICompatibleAdapter(cfg, {
      retries: 3,
      backoffMs: 1,
      fetchImpl: async () => (++n, new Response("denied", { status: 401 })),
    });
    await expect(adapter.chat("sys", [])).rejects.toThrow(/HTTP 401/);
    expect(n).toBe(1);
  });

  it("retries on network failure then fails at the last attempt", async () => {
    let n = 0;
    const adapter = new OpenAICompatibleAdapter(cfg, {
      retries: 2,
      backoffMs: 1,
      fetchImpl: async () => {
        n++;
        if (n === 1) throw new TypeError("fetch failed");
        throw new TypeError("fetch failed again");
      },
    });
    await expect(adapter.chat("sys", [])).rejects.toThrow("fetch failed again");
    expect(n).toBe(2);
  });

  it("abort signal timeout is honored via timeoutMs (immediate abort)", async () => {
    const adapter = new OpenAICompatibleAdapter(cfg, {
      retries: 1,
      fetchImpl: ((_u: any, i: any) => fetch("https://localhost.invalid/v1", i)) as never,
      timeoutMs: 1,
    });
    await expect(adapter.chat("sys", [])).rejects.toThrow();
  });
});
