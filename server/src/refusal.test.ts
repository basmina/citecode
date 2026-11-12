import { describe, expect, it } from "vitest";
import { isNotFoundAnswer, stripCitations } from "./refusal.js";

describe("isNotFoundAnswer", () => {
  it("detects the refusal prefix, ignoring case and leading space", () => {
    expect(isNotFoundAnswer("Not found in this repo. It is a frontend app.")).toBe(true);
    expect(isNotFoundAnswer("  not found in this repo.")).toBe(true);
  });
  it("does not flag a normal answer", () => {
    expect(isNotFoundAnswer("Auth uses a JWT [a.ts:1-5].")).toBe(false);
  });
});

describe("stripCitations", () => {
  it("removes a single citation", () => {
    expect(stripCitations("Not found in this repo. See the app [src/app.ts:1-10].")).toBe(
      "Not found in this repo. See the app."
    );
  });
  it("removes several citations and multi-citation brackets", () => {
    expect(stripCitations("No GraphQL [a.ts:1-5] [b.ts:7-9, c.ts:2-4] here.")).toBe("No GraphQL here.");
  });
  it("keeps other square brackets", () => {
    expect(stripCitations("Use arr[0] and [note].")).toBe("Use arr[0] and [note].");
  });
});