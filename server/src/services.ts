import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.js";
import { createLogger } from "./logger.js";
import { createPool } from "./db.js";
import { createStore } from "./store.js";
import { createEmbedder } from "./embeddings.js";
import { createBm25Index } from "./bm25.js";
import { createHybridSearch } from "./hybrid.js";
import { createAgent } from "./agent.js";
import { createIngestor } from "./ingest.js";

export function createServices(config: Config) {
  const logger = createLogger(config.logLevel);
  const pool = createPool(config.databaseUrl);
  const store = createStore(pool);
  const embedder = createEmbedder();
  const bm25 = createBm25Index();
  const hybridSearch = createHybridSearch({ embedder, store, bm25 });
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const agent = createAgent({ client, config, logger, store, bm25, hybridSearch });
  const ingestor = createIngestor({ embedder, store, bm25, logger, config });
  return { config, logger, pool, store, embedder, bm25, hybridSearch, agent, ingestor };
}

export type Services = ReturnType<typeof createServices>;
