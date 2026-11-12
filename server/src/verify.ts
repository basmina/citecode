import { extractCitations } from "./citations.js";
import type { Store } from "./store.js";
import type { Logger } from "./logger.js";

export interface VerifiedCitation {
  path: string;
  start: number;
  end: number;
  valid: boolean;
}

const MAX_CITATIONS = 40;

export interface VerifierDeps {
  store: Pick<Store, "getFileLines">;
  logger: Pick<Logger, "warn">;
}

export function createCitationVerifier({ store, logger }: VerifierDeps) {
  return async function verifyCitations(repoId: string, answer: string): Promise<VerifiedCitation[]> {
    try {
      const seen = new Set<string>();
      const out: VerifiedCitation[] = [];
      for (const c of extractCitations(answer)) {
        const key = `${c.path}:${c.start}-${c.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (out.length >= MAX_CITATIONS) break;
        const file = await store.getFileLines(repoId, c.path, c.start, c.end);
        out.push({ ...c, valid: !!file && c.start <= file.total && c.end >= c.start });
      }
      return out;
    } catch (err) {
      logger.warn({ err }, "citation verification failed");
      return [];
    }
  };
}
