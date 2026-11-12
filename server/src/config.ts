import "dotenv/config";
import { z } from "zod";

const positiveInt = (fallback: number) => z.coerce.number().int().min(1).default(fallback);

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string("is required").min(1, "is required"),
  DATABASE_URL: z.string("is required").min(1, "is required"),
  LLM_MODEL: z.string().min(1).default("claude-haiku-5-5"),
  MAX_AGENT_STEPS: positiveInt(6),
  MAX_REPO_FILES: positiveInt(1500),
  MAX_CHUNKS: positiveInt(3000),
  PORT: positiveInt(3000),
  CLIENT_ORIGIN: z.string().min(1).default("http://localhost:4200"),
  GITHUB_TOKEN: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export interface Config {
  anthropicApiKey: string;
  databaseUrl: string;
  llmModel: string;
  maxAgentSteps: number;
  maxRepoFiles: number;
  maxChunks: number;
  port: number;
  clientOrigin: string;
  githubToken?: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
}

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== ""));
  const parsed = envSchema.safeParse(present);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`);
    throw new ConfigError(`Invalid configuration:\n- ${problems.join("\n- ")}`);
  }
  const e = parsed.data;
  return {
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    databaseUrl: e.DATABASE_URL,
    llmModel: e.LLM_MODEL,
    maxAgentSteps: e.MAX_AGENT_STEPS,
    maxRepoFiles: e.MAX_REPO_FILES,
    maxChunks: e.MAX_CHUNKS,
    port: e.PORT,
    clientOrigin: e.CLIENT_ORIGIN,
    githubToken: e.GITHUB_TOKEN,
    logLevel: e.LOG_LEVEL,
  };
}
