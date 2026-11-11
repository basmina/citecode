import { describe, it, expect } from "vitest";
import { shouldIndex, isSkippedPath } from "./files.js";

describe("shouldIndex", () => {
  it("accepts normal source files", () => {
    expect(shouldIndex("src/app.ts", 1000)).toBe(true);
    expect(shouldIndex("README.md", 1000)).toBe(true);
  });

  it("never indexes secrets", () => {
    expect(shouldIndex(".env", 10)).toBe(false);
    expect(shouldIndex(".env.local", 10)).toBe(false);
    expect(shouldIndex("config/.env.production", 10)).toBe(false);
  });

  it("skips lockfiles, minified files, binaries and big files", () => {
    expect(shouldIndex("package-lock.json", 10)).toBe(false);
    expect(shouldIndex("app.min.js", 10)).toBe(false);
    expect(shouldIndex("logo.png", 10)).toBe(false);
    expect(shouldIndex("big.ts", 300 * 1024)).toBe(false);
  });
});

describe("isSkippedPath", () => {
  it("skips dependency and build folders", () => {
    expect(isSkippedPath("a/node_modules/b.js")).toBe(true);
    expect(isSkippedPath("dist/main.js")).toBe(true);
    expect(isSkippedPath("src/app.ts")).toBe(false);
  });
});