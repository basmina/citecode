import { describe, it, expect, beforeEach } from "vitest";
import { createBm25Index } from "./bm25.js";

const chunk = (id: number, filePath: string, content: string) => ({
  id,
  filePath,
  startLine: 1,
  endLine: 10,
  content,
});

const auth = chunk(1, "src/auth.service.ts", "export class AuthService { login() {} }");
const cart = chunk(2, "src/cart.reducer.ts", "export const cartReducer = createReducer()");

describe("bm25", () => {
  let bm25: ReturnType<typeof createBm25Index>;

  beforeEach(() => {
    bm25 = createBm25Index();
  });

  it("finds a camelCase identifier by a partial word", () => {
    bm25.build("r1", [auth, cart]);
    expect(bm25.search("r1", "auth", 5)[0].id).toBe(1);
  });

  it("matches an exact identifier", () => {
    bm25.build("r1", [auth, cart]);
    expect(bm25.search("r1", "cartReducer", 5)[0].id).toBe(2);
  });

  it("returns nothing for an unknown repo", () => {
    expect(bm25.search("does-not-exist", "auth", 5)).toEqual([]);
  });

  it("keeps repositories separate", () => {
    bm25.build("a", [auth]);
    bm25.build("b", [cart]);
    expect(bm25.search("b", "auth", 5)).toEqual([]);
  });
});