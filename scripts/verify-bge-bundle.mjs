import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const TRACE_PATH = path.join(
  process.cwd(),
  ".next/server/app/api/fit/analyze/route.js.nft.json",
);
const TRACE_LIMIT_BYTES = 225 * 1024 * 1024;
const REQUIRED_PATHS = [
  "node_modules/@xenova/transformers/",
  "node_modules/onnxruntime-node/",
  "models/Xenova/bge-small-en-v1.5/config.json",
  "models/Xenova/bge-small-en-v1.5/tokenizer.json",
  "models/Xenova/bge-small-en-v1.5/onnx/model_quantized.onnx",
];

const trace = JSON.parse(await readFile(TRACE_PATH, "utf8"));
const traceDirectory = path.dirname(TRACE_PATH);
const entries = [
  ...new Map(
    trace.files.map((file) => {
      const absolute = path.resolve(traceDirectory, file);
      return [
        absolute,
        {
          file,
          normalized: path.normalize(file).replaceAll("\\", "/"),
          absolute,
        },
      ];
    }),
  ).values(),
];

for (const required of REQUIRED_PATHS) {
  if (!entries.some((entry) => entry.normalized.includes(required))) {
    throw new Error(`Fit Analyzer trace is missing required BGE path: ${required}`);
  }
}

let totalBytes = 0;
for (const entry of entries) {
  totalBytes += (await stat(entry.absolute)).size;
}

if (totalBytes > TRACE_LIMIT_BYTES) {
  throw new Error(
    `Fit Analyzer trace is too large: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`,
  );
}

console.info(
  `[bge-bundle] Verified ${entries.length} files (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`,
);
