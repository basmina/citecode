import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".angular", ".next", "out"]);
const SKIP_FILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);
const ALLOWED_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".css", ".scss",
  ".md", ".py", ".java", ".cs", ".go", ".yml", ".yaml",
]);
const MAX_FILE_BYTES = 200 * 1024;

export interface SourceFile {
  path: string;
  text: string;
}

export function shouldIndex(relPath: string, size: number): boolean {
  const name = path.basename(relPath).toLowerCase();
  if (SKIP_FILES.has(name)) return false;
  if (name.startsWith(".env")) return false;
  if (name.endsWith(".min.js")) return false;
  if (size > MAX_FILE_BYTES) return false;
  return ALLOWED_EXT.has(path.extname(name));
}

export async function readLocalFiles(root: string, dir = root): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...(await readLocalFiles(root, full)));
    } else {
      const rel = path.relative(root, full).split(path.sep).join("/");
      const { size } = await stat(full);
      if (shouldIndex(rel, size)) out.push({ path: rel, text: await readFile(full, "utf8") });
    }
  }
  return out;
}
export function isSkippedPath(relPath: string): boolean {
  return relPath.split("/").some((seg) => SKIP_DIRS.has(seg));
}