/**
 * Local embedding client - BGE-small-en-v1.5 (384-dim), never a paid API.
 *
 * When EMBEDDINGS_ENABLED=true, the live plane uses @xenova/transformers with
 * CLS pooling + L2 normalization. Otherwise it falls back to a deterministic
 * mock vector so dev/test need no native model load.
 *
 * These embeddings power semantic fit scoring and behavioural/case retrieval
 * helpers. O*NET itself stays a local JSON dictionary, not a vector index.
 */
import { EMBEDDING_DIM, type Embedding } from "@/lib/types";
import { embeddingsEnabled, embeddingsModel } from "@/lib/config";

/** BGE asymmetric-retrieval instruction (queries only; passages get no prefix). */
export const BGE_QUERY_PREFIX =
  "Represent this sentence for searching relevant passages: ";

function normalize(v: number[]): Embedding {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

/**
 * Deterministic, L2-normalized pseudo-embedding. Stable for the same input so
 * retrieval is consistent in dev/test. NOT semantically meaningful - real ranking
 * requires EMBEDDINGS_ENABLED=true with @xenova/transformers installed.
 */
export function mockEmbed(text: string): Embedding {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
    v[h % EMBEDDING_DIM] += 1;
    v[(h >>> 7) % EMBEDDING_DIM] += 0.5;
  }
  return normalize(v);
}

// Lazily-created transformers.js pipeline. The indirect import hides the
// specifier from TS + the bundler so the package is only resolved when enabled.
type Extractor = (input: string, opts: unknown) => Promise<{ data: Float32Array }>;
const dynamicImport = new Function("m", "return import(m)") as (
  m: string,
) => Promise<{ pipeline: (task: string, model: string) => Promise<Extractor> }>;
type ExtractorLoader = () => Promise<Extractor>;

export type EmbeddingFailureCategory = "load" | "inference";

export class EmbeddingError extends Error {
  constructor(
    readonly category: EmbeddingFailureCategory,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "unknown error";
}

async function defaultExtractorLoader(): Promise<Extractor> {
  const mod = await dynamicImport("@xenova/transformers");
  return mod.pipeline("feature-extraction", embeddingsModel());
}

let _extractor: Promise<Extractor> | null = null;
let extractorLoader: ExtractorLoader = defaultExtractorLoader;

export function setEmbeddingLoaderForTests(loader: ExtractorLoader): () => void {
  const previous = extractorLoader;
  extractorLoader = loader;
  _extractor = null;
  return () => {
    extractorLoader = previous;
    _extractor = null;
  };
}

async function getExtractor(): Promise<Extractor> {
  if (!_extractor) {
    const model = embeddingsModel();
    _extractor = extractorLoader().then((extractor) => {
      console.info(`[embeddings] BGE loaded (${model})`);
      return extractor;
    });
  }
  try {
    return await _extractor;
  } catch (error) {
    _extractor = null;
    throw new EmbeddingError(
      "load",
      `BGE embedding load failed: ${errorMessage(error)}`,
      error,
    );
  }
}

function inputFor(text: string, opts: { query?: boolean }): string {
  return opts.query ? BGE_QUERY_PREFIX + text : text;
}

async function runExtractor(
  extractor: Extractor,
  input: string,
): Promise<Embedding> {
  try {
    const out = await extractor(input, { pooling: "cls", normalize: true });
    const embedding = Array.from(out.data);
    if (embedding.length !== EMBEDDING_DIM) {
      throw new Error(`expected ${EMBEDDING_DIM} dimensions, received ${embedding.length}`);
    }
    return embedding;
  } catch (error) {
    if (error instanceof EmbeddingError) throw error;
    throw new EmbeddingError(
      "inference",
      `BGE embedding inference failed: ${errorMessage(error)}`,
      error,
    );
  }
}

export async function embedStrict(
  text: string,
  opts: { query?: boolean } = {},
): Promise<Embedding> {
  const extractor = await getExtractor();
  return runExtractor(extractor, inputFor(text, opts));
}

export async function embedBatchStrict(
  texts: string[],
  opts: { query?: boolean } = {},
): Promise<Embedding[]> {
  const extractor = await getExtractor();
  return Promise.all(texts.map((text) => runExtractor(extractor, inputFor(text, opts))));
}

export async function embed(
  text: string,
  opts: { query?: boolean } = {},
): Promise<Embedding> {
  const input = inputFor(text, opts);
  if (!embeddingsEnabled()) return mockEmbed(input);
  try {
    return await embedStrict(text, opts);
  } catch {
    // Optional dep missing or failed to load: fall back to deterministic mock.
    return mockEmbed(input);
  }
}

export async function embedBatch(
  texts: string[],
  opts: { query?: boolean } = {},
): Promise<Embedding[]> {
  return Promise.all(texts.map((t) => embed(t, opts)));
}

export function cosine(a: Embedding, b: Embedding): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
