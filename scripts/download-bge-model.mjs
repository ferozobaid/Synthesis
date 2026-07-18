import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const MODEL_ID = process.env.EMBEDDINGS_MODEL || "Xenova/bge-small-en-v1.5";
const MODEL_REVISION =
  process.env.EMBEDDINGS_MODEL_REVISION ||
  "ea104dacec62c0de699686887e3f920caeb4f3e3";
const MODEL_ROOT = path.join(process.cwd(), "models");

const REQUIRED_FILES = [
  { path: "config.json", minimumBytes: 100 },
  { path: "tokenizer.json", minimumBytes: 100_000 },
  { path: "tokenizer_config.json", minimumBytes: 100 },
  { path: "onnx/model_quantized.onnx", minimumBytes: 10_000_000 },
];

function modelFilePath(relativePath) {
  return path.join(MODEL_ROOT, ...MODEL_ID.split("/"), ...relativePath.split("/"));
}

async function isValidFile(file) {
  try {
    return (await stat(modelFilePath(file.path))).size >= file.minimumBytes;
  } catch {
    return false;
  }
}

async function downloadFile(file) {
  const destination = modelFilePath(file.path);
  const temporary = `${destination}.download`;
  const url = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/${file.path}`;

  await mkdir(path.dirname(destination), { recursive: true });
  await rm(temporary, { force: true });

  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`BGE model download failed (${response.status}) for ${file.path}`);
  }

  const data = Buffer.from(await response.arrayBuffer());
  if (data.byteLength < file.minimumBytes) {
    throw new Error(
      `BGE model file ${file.path} is unexpectedly small (${data.byteLength} bytes)`,
    );
  }

  await writeFile(temporary, data);
  await rename(temporary, destination);
  console.info(`[bge-build] Downloaded ${file.path} (${data.byteLength} bytes)`);
}

if (process.env.BGE_SKIP_MODEL_DOWNLOAD === "true") {
  console.warn("[bge-build] Skipping the BGE model download by request");
  process.exit(0);
}

for (const file of REQUIRED_FILES) {
  if (!(await isValidFile(file))) await downloadFile(file);
}

console.info(
  `[bge-build] Model ready: ${MODEL_ID}@${MODEL_REVISION} (${MODEL_ROOT})`,
);
