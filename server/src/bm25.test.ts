import { describe, it, expect } from "vitest";
import { buildBm25, bm25Search } from "./bm25.js";

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
  it("finds a camelCase identifier by a partial word", () => {
    buildBm25("r1", [auth, cart]);
    expect(bm25Search("r1", "auth", 5)[0].id).toBe(1);
  });

  it("matches an exact identifier", () => {
    buildBm25("r1", [auth, cart]);
    expect(bm25Search("r1", "cartReducer", 5)[0].id).toBe(2);
  });

  it("returns nothing for an unknown repo", () => {
    expect(bm25Search("does-not-exist", "auth", 5)).toEqual([]);
  });

  it("keeps repositories separate", () => {
    buildBm25("a", [auth]);
    buildBm25("b", [cart]);
    expect(bm25Search("b", "auth", 5)).toEqual([]);
  });
});