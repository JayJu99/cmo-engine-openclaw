import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const runtimeRoots = ["src", "services"];
const ignoredDirs = new Set(["node_modules", ".next", ".tmp", ".git"]);
const scannedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const bannedRuntimeCopy = [
  "Creative Agent generated an image artifact",
  "explicit CMO creative request",
  "Nếu ok, bạn nói",
  "Neu ok, ban noi",
  "Ok bạn tạo đi",
  "Ok ban tao di",
  "Preview is pending artifact transport",
  "Creative execution completed and returned generated asset metadata",
  "Product recorded the asset metadata",
  "Creative generated an asset",
  "Product received Creative metadata, but no retrievable browser artifact was included",
];

function walk(dir) {
  const absoluteDir = path.join(root, dir);
  const entries = readdirSync(absoluteDir);
  const files = [];

  for (const entry of entries) {
    if (ignoredDirs.has(entry)) {
      continue;
    }

    const absolutePath = path.join(absoluteDir, entry);
    const relativePath = path.relative(root, absolutePath);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      files.push(...walk(relativePath));
      continue;
    }

    if (stats.isFile() && scannedExtensions.has(path.extname(entry))) {
      files.push(relativePath);
    }
  }

  return files;
}

const failures = [];

for (const file of runtimeRoots.flatMap(walk)) {
  const source = readFileSync(path.join(root, file), "utf8");

  for (const banned of bannedRuntimeCopy) {
    if (source.includes(banned)) {
      failures.push(`${file}: banned Creative user-facing template: ${banned}`);
    }
  }
}

assert.deepEqual(failures, [], failures.join("\n"));
console.log("CMO Creative user-facing copy audit passed");
