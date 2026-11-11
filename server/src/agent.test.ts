import { describe, it, expect, vi, beforeEach } from "vitest";

const { streamMock, hybridMock } = vi.hoisted(() => {
  process.env.MAX_AGENT_STEPS = "3";
  return { streamMock: vi.fn(), hybridMock: vi.fn() };
});

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: streamMock };
  },
}));
vi.mock("./hybrid.js", () => ({ hybridSearch: hybridMock }));
vi.mock("./bm25.js", () => ({ hasBm25: () => true, buildBm25: vi.fn() }));
vi.mock("./store.js", () => ({
  loadChunks: vi.fn(),
  listFiles: vi.fn().mockResolvedValue(["a.ts"]),
  getFileLines: vi.fn(),
}));
vi.mock("./logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ask } from "./agent.js";

const turn = (content: unknown[], stop_reason: string) => ({
  on: vi.fn(),
  finalMessage: async () => ({ content, stop_reason, usage: { input_tokens: 10, output_tokens: 5 } }),
});
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });
const text = (t: string) => ({ type: "text", text: t });

beforeEach(() => {
  streamMock.mockReset();
  hybridMock.mockReset();
});

describe("agent loop", () => {
  it("runs a requested tool, feeds the result back, and returns Claude's final answer", async () => {
    hybridMock.mockResolvedValue([
      { id: 1, filePath: "a.ts", startLine: 1, endLine: 5, content: "code", score: 0.03, sources: ["bm25"] },
    ]);
    streamMock
      .mockReturnValueOnce(turn([toolUse("t1", "search_code", { query: "auth" })], "tool_use"))
      .mockReturnValueOnce(turn([text("Auth is in [a.ts:1-5].")], "end_turn"));

    const onStatus = vi.fn();
    const onReset = vi.fn();
    const { answer, stats } = await ask("repo", "how does auth work", { onStatus, onReset });

    expect(answer).toContain("[a.ts:1-5]");
    expect(stats.steps).toBe(2);
    expect(stats.chunksRetrieved).toBe(1);
    expect(stats.toolCalls).toEqual([{ name: "search_code", input: { query: "auth" } }]);
    expect(onStatus).toHaveBeenCalledWith('Searching code for "auth"');
    expect(onReset).toHaveBeenCalledTimes(1);

    const sent = streamMock.mock.calls[1][0].messages;
    expect(sent[sent.length - 1].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
  });

  it("stops after the step limit instead of looping forever", async () => {
    hybridMock.mockResolvedValue([]);
    streamMock.mockImplementation(() => turn([toolUse("t", "search_code", { query: "auth" })], "tool_use"));

    const { answer } = await ask("repo", "loop forever");

    expect(streamMock).toHaveBeenCalledTimes(3);
    expect(answer).toContain("step limit");
  });

  it("returns invalid tool arguments to Claude as an error instead of crashing", async () => {
    streamMock
      .mockReturnValueOnce(turn([toolUse("t1", "search_code", {})], "tool_use"))
      .mockReturnValueOnce(turn([text("Not found in this repo.")], "end_turn"));

    await ask("repo", "question");

    const sent = streamMock.mock.calls[1][0].messages;
    expect(sent[sent.length - 1].content[0]).toMatchObject({
      type: "tool_result",
      is_error: true,
      content: expect.stringContaining("Tool error"),
    });
  });

  it("validates the question", async () => {
    await expect(ask("repo", "   ")).rejects.toThrow("empty");
    await expect(ask("repo", "x".repeat(1001))).rejects.toThrow("too long");
  });
});