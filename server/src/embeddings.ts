import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

export function createEmbedder() {
  let extractor: Promise<FeatureExtractionPipeline> | undefined;

  const getExtractor = () => {
    extractor ??= pipeline("feature-extraction", MODEL_NAME) as unknown as Promise<FeatureExtractionPipeline>;
    return extractor;
  };

  async function embed(texts: string[], batchSize = 16): Promise<number[][]> {
    const ex = await getExtractor();
    const result: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const out = await ex(texts.slice(i, i + batchSize), { pooling: "mean", normalize: true });
      result.push(...(out.tolist() as number[][]));
    }
    return result;
  }

  return { embed };
}

export type Embedder = ReturnType<typeof createEmbedder>;
