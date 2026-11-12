// Helpers for "Not found in this repo." answers.
// The prompt tells the model not to cite in a refusal, but models do not always obey.
// These helpers let the server enforce the rule in code.

export function isNotFoundAnswer(answer: string): boolean {
  return /^\s*not found in this repo/i.test(answer);
}

// Matches one bracket holding one or more citations, e.g. [a.ts:1-10] or [a.ts:1-10, b.ts:5-20].
const CITATION_BRACKET =
  /\s*\[[^\s\[\],;:]+:\d+(?:-\d+)?(?:\s*[,;]\s*[^\s\[\],;:]+:\d+(?:-\d+)?)*\]/g;

export function stripCitations(answer: string): string {
  return answer.replace(CITATION_BRACKET, "").replace(/[ \t]{2,}/g, " ").trim();
}