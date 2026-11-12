
export function isNotFoundAnswer(answer: string): boolean {
  return /^\s*not found in this repo/i.test(answer);
}

const CITATION_BRACKET =
  /\s*\[[^\s\[\],;:]+:\d+(?:-\d+)?(?:\s*[,;]\s*[^\s\[\],;:]+:\d+(?:-\d+)?)*\]/g;

export function stripCitations(answer: string): string {
  return answer.replace(CITATION_BRACKET, "").replace(/[ \t]{2,}/g, " ").trim();
}