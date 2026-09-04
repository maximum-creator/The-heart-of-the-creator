#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FORMAT_VERSION = 1;

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalText(value) {
  return value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n").replace(/\n*$/, "\n");
}

function assertRelativeFile(rootReal, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`context path must be a non-empty project-relative path: ${relativePath}`);
  }
  const candidate = path.resolve(rootReal, relativePath);
  const rel = path.relative(rootReal, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`context path escapes project root: ${relativePath}`);
  const real = fs.realpathSync(candidate);
  const realRel = path.relative(rootReal, real);
  if (realRel.startsWith("..") || path.isAbsolute(realRel)) throw new Error(`context symlink escapes project root: ${relativePath}`);
  if (!fs.statSync(real).isFile()) throw new Error(`context entry is not a file: ${relativePath}`);
  return real;
}

function normalizeEntries(entries, kind) {
  if (!Array.isArray(entries)) throw new Error(`${kind} must be an array`);
  const seenLabels = new Set();
  const seenPaths = new Set();
  return entries.map((entry, index) => {
    if (!entry || typeof entry.label !== "string" || !entry.label.trim() || typeof entry.path !== "string") {
      throw new Error(`${kind}[${index}] requires label and path`);
    }
    const label = canonicalText(entry.label).trim();
    const relPath = entry.path.replace(/\\/g, "/");
    if (seenLabels.has(label)) throw new Error(`duplicate ${kind} label: ${label}`);
    if (seenPaths.has(relPath)) throw new Error(`duplicate ${kind} path: ${relPath}`);
    seenLabels.add(label);
    seenPaths.add(relPath);
    return { label, path: relPath };
  });
}

function compileSection(rootReal, entries, sectionName) {
  const chunks = [`<!-- NovelOS ${sectionName} v${FORMAT_VERSION} -->\n`];
  const files = [];
  for (const entry of entries) {
    const file = assertRelativeFile(rootReal, entry.path);
    const content = canonicalText(fs.readFileSync(file, "utf8"));
    const contentHash = sha256(content);
    chunks.push(`\n## ${entry.label}\n\n${content}`);
    files.push({ label: entry.label, path: entry.path, chars: [...content].length, sha256: contentHash });
  }
  const text = canonicalText(chunks.join(""));
  return { text, chars: [...text].length, sha256: sha256(text), files };
}

export function buildCacheContext({ root, manifest, outDir }) {
  const rootReal = fs.realpathSync(path.resolve(root));
  const manifestPath = assertRelativeFile(rootReal, manifest);
  const spec = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (spec.version !== FORMAT_VERSION) throw new Error(`unsupported manifest version: ${spec.version}`);

  const stableEntries = normalizeEntries(spec.stable, "stable");
  const variableEntries = normalizeEntries(spec.variable, "variable");
  if (!stableEntries.length) throw new Error("stable must contain at least one entry");
  const overlap = new Set(stableEntries.map((entry) => entry.path));
  for (const entry of variableEntries) if (overlap.has(entry.path)) throw new Error(`file appears in both stable and variable: ${entry.path}`);

  const stable = compileSection(rootReal, stableEntries, "stable-prefix");
  const variable = compileSection(rootReal, variableEntries, "variable-suffix");
  const requestText = canonicalText(`${stable.text}\n${variable.text}`);
  const meta = {
    formatVersion: FORMAT_VERSION,
    stablePrefixHash: stable.sha256,
    variableSuffixHash: variable.sha256,
    requestContextHash: sha256(requestText),
    stableChars: stable.chars,
    variableChars: variable.chars,
    requestChars: [...requestText].length,
    stableFiles: stable.files,
    variableFiles: variable.files
  };

  const output = path.resolve(rootReal, outDir);
  const outputRel = path.relative(rootReal, output);
  if (outputRel.startsWith("..") || path.isAbsolute(outputRel)) throw new Error("output directory escapes project root");
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "stable-prefix.md"), stable.text, "utf8");
  fs.writeFileSync(path.join(output, "variable-suffix.md"), variable.text, "utf8");
  fs.writeFileSync(path.join(output, "request-context.md"), requestText, "utf8");
  fs.writeFileSync(path.join(output, "cache-meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return meta;
}

function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith("--") || argv[i + 1] === undefined) throw new Error("usage: --root <dir> --manifest <relative-json> --out <relative-dir>");
    values[key.slice(2)] = argv[i + 1];
  }
  if (!values.root || !values.manifest || !values.out) throw new Error("usage: --root <dir> --manifest <relative-json> --out <relative-dir>");
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(buildCacheContext({ root: args.root, manifest: args.manifest, outDir: args.out }), null, 2)}\n`);
}
