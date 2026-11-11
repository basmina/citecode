import { pipeline } from "@huggingface/transformers";

let extractor: any = null;

async function getExtractor() {
  extractor ??= await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  return extractor;
}

export async function embed(texts: string[], batchSize = 16): Promise<number[][]> {
  const ex = await getExtractor();
  const result: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const out = await ex(texts.slice(i, i + batchSize), { pooling: "mean", normalize: true });
    result.push(...(out.tolist() as number[][]));
  }
  return result;
}