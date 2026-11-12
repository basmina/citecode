import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError } from "./config.js";

const required = { ANTHROPIC_API_KEY: "key", DATABASE_URL: "postgres://db" };

describe("loadConfig", () => {
  it("applies defaults for optional settings", () => {
    const config = loadConfig(required);
    expect(config).toMatchObject({
      anthropicApiKey: "key",
      databaseUrl: "postgres://db",
      llmModel: "claude-haiku-5-5",
      maxAgentSteps: 6,
      maxRepoFiles: 1500,
      maxChunks: 3000,
      port: 3000,
      clientOrigin: "http://localhost:4200",
      logLevel: "info",
    });
    expect(config.githubToken).toBeUndefined();
  });

  it("reads numbers and optional values from the environment", () => {
    const config = loadConfig({ ...required, MAX_AGENT_STEPS: "3", PORT: "8080", GITHUB_TOKEN: "t", LOG_LEVEL: "warn" });
    expect(config).toMatchObject({ maxAgentSteps: 3, port: 8080, githubToken: "t", logLevel: "warn" });
  });

  it("treats empty values as not set", () => {
    const config = loadConfig({ ...required, GITHUB_TOKEN: "", LLM_MODEL: "" });
    expect(config.githubToken).toBeUndefined();
    expect(config.llmModel).toBe("claude-haiku-5-5");
  });

  it("fails at startup and names every missing required setting", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/ANTHROPIC_API_KEY[\s\S]*DATABASE_URL/);
  });

  it("rejects a number that is not a positive integer", () => {
    expect(() => loadConfig({ ...required, MAX_AGENT_STEPS: "abc" })).toThrow("MAX_AGENT_STEPS");
    expect(() => loadConfig({ ...required, MAX_AGENT_STEPS: "0" })).toThrow("MAX_AGENT_STEPS");
  });
});
