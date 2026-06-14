/**
 * Local embedding client — BGE-small-en-v1.5 (384-dim), never a paid API.
 *
 * Live plane uses @xenova/transformers (CLS pooling + L2 normalize) when
 * EMBEDDINGS_ENABLED=true and the optional dep is installed; otherwise it falls
 * back to a deterministic mock vector so dev/test need no native build. The offline
 * ingestion pipeline (Python sentence-transformers, BAAI/bge-small-en-v1.5) uses the
 * same model + pooling so vectors are comparable — a parity test asserts cosine > 0.99.
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
 * retrieval is consistent in dev/test. NOT semantically meaningful — real ranking
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

// Lazily-created transformers.js pipeline (OPTIONAL, uninstalled by default).
// The indirect import hides the specifier from TS + the bundler so the package is
// only resolved at runtime when actually enabled — keeping install/build lean.
type Extractor = (input: string, opts: unknown) => Promise<{ data: Float32Array }>;
const dynamicImport = new Function("m", "return import(m)") as (
  m: string,
) => Promise<{ pipeline: (task: string, model: string) => Promise<Extractor> }>;

let _extractor: Promise<Extractor> | null = null;
async function getExtractor(): Promise<Extractor> {
  if (!_extractor) {
    _extractor = dynamicImport("@xenova/transformers").then((mod) =>
      mod.pipeline("feature-extraction", embeddingsModel()),
    );
  }
  return _extractor;
}

export async function embed(
  text: string,
  opts: { query?: boolean } = {},
): Promise<Embedding> {
  const input = opts.query ? BGE_QUERY_PREFIX + text : text;
  if (!embeddingsEnabled()) return mockEmbed(input);
  try {
    const extractor = await getExtractor();
    const out = await extractor(input, { pooling: "cls", normalize: true });
    return Array.from(out.data);
  } catch {
    // Optional dep missing or failed to load — fall back to the deterministic mock.
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
