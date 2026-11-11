export interface Citation {
  path: string;
  start: number;
  end: number;
}

const PART = "[^\\s\\[\\],;:]+:\\d+(?:-\\d+)?";
const GROUP = new RegExp(`\\[(${PART}(?:\\s*[,;]\\s*${PART})*)\\]`, "g");

export function extractCitations(text: string): Citation[] {
  const out: Citation[] = [];
  for (const m of text.matchAll(GROUP)) {
    for (const part of m[1].split(/\s*[,;]\s*/)) {
      const c = /^(.+):(\d+)(?:-(\d+))?$/.exec(part);
      if (!c) continue;
      const start = Number(c[2]);
      out.push({ path: c[1], start, end: c[3] ? Number(c[3]) : start });
    }
  }
  return out;
}