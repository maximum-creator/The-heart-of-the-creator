#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith("--") || argv[i + 1] === undefined) throw new Error("Arguments must be --key value pairs");
    args[key.slice(2)] = argv[i + 1];
  }
  return args;
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function stableRank(seed, testId, candidateId) {
  return sha256(`${seed}\0${testId}\0${candidateId}`);
}

function sanitize(text, candidateId) {
  const lines = String(text ?? "").replace(/^\uFEFF/u, "").replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && /^\s*(?:model|模型|provider|供应商|candidate|候选)\s*[:：]/iu.test(lines[0])) lines.shift();
  const result = `${lines.join("\n").trim()}\n`;
  if (/^\s*(?:model|模型|provider|供应商|candidate|候选)\s*[:：]/imu.test(result)) throw new Error(`Identity metadata remains inside candidate ${candidateId}`);
  const identityTokens = String(candidateId).split(/[^a-zA-Z0-9.]+/u).filter((item) => item.length >= 4 && !new Set(["feelfish", "local", "reference"]).has(item.toLowerCase()));
  for (const token of identityTokens) if (result.toLowerCase().includes(token.toLowerCase())) throw new Error(`Candidate identity token ${token} remains inside ${candidateId}`);
  return result;
}

function ensureUnusedOutputs(outDir, mapPath) {
  if (fs.existsSync(outDir)) throw new Error(`Output already exists; choose a new directory: ${outDir}`);
  if (fs.existsSync(mapPath)) throw new Error(`Private map already exists; choose a new file: ${mapPath}`);
  const outPrefix = outDir.endsWith(path.sep) ? outDir : `${outDir}${path.sep}`;
  if (mapPath === outDir || mapPath.startsWith(outPrefix)) throw new Error("Private map must be outside the anonymous output directory");
}

export function buildBlindPack({ plan, rawDir, outDir, mapPath, seed, testIds = null, reference = null, now = () => new Date().toISOString() }) {
  if (!plan || !Array.isArray(plan.tests)) throw new Error("Plan must contain a tests array");
  if (!seed) throw new Error("A non-empty seed is required");
  const rawRoot = path.resolve(rawDir);
  const outputRoot = path.resolve(outDir);
  const privateMapPath = path.resolve(mapPath);
  if (!fs.existsSync(rawRoot) || !fs.statSync(rawRoot).isDirectory()) throw new Error(`Raw directory missing: ${rawRoot}`);
  ensureUnusedOutputs(outputRoot, privateMapPath);

  const requested = testIds ? new Set(testIds) : null;
  if (requested) {
    const known = new Set(plan.tests.map((test) => test.id));
    for (const id of requested) if (!known.has(id)) throw new Error(`Unknown test id: ${id}`);
  }
  if (reference && (!reference.testId || !reference.path || !reference.id)) throw new Error("Reference requires testId, path and id");
  if (reference && requested && !requested.has(reference.testId)) throw new Error("Reference testId must be included in --test");
  if (reference && !requested) throw new Error("Use an explicit --test when adding a reference candidate");

  const selected = plan.tests.filter((test) => (!requested || requested.has(test.id)) && ((test.candidates || []).length || reference?.testId === test.id));
  if (!selected.length) throw new Error("No candidate-bearing tests selected");
  const prepared = [];
  for (const test of selected) {
    const candidates = (test.candidates || []).map((id) => ({ id, source: path.join(rawRoot, safeName(id), `${test.id}.md`) }));
    if (reference?.testId === test.id) candidates.push({ id: reference.id, source: path.resolve(reference.path), reference: true });
    const ids = candidates.map((item) => item.id);
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate candidate id in ${test.id}`);
    if (candidates.length > 26) throw new Error(`${test.id} has more than 26 candidates`);
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate.source) || !fs.statSync(candidate.source).isFile()) throw new Error(`Missing candidate output: ${candidate.source}`);
      const rawText = fs.readFileSync(candidate.source, "utf8");
      const anonymousText = sanitize(rawText, candidate.id);
      prepared.push({ test, candidate, rawText, anonymousText });
    }
  }

  fs.mkdirSync(outputRoot, { recursive: false });
  fs.mkdirSync(path.dirname(privateMapPath), { recursive: true });
  const privateMap = { version: 2, suite: plan.suite, seed, createdAt: now(), tests: {} };
  const review = ["# 匿名盲审表", "", "先判硬失败，再写两两偏好与可定位证据。不得猜测模型身份；只有一份稿时不得形成比较结论。", ""];
  let totalCandidates = 0;
  for (const test of selected) {
    const entries = prepared.filter((item) => item.test.id === test.id).sort((a, b) => stableRank(seed, test.id, a.candidate.id).localeCompare(stableRank(seed, test.id, b.candidate.id)));
    privateMap.tests[test.id] = {};
    review.push(`## ${test.id}`, "", `目的：${test.purpose}`, "", `比较就绪：${entries.length >= 2 ? "是" : "否（至少需要两份稿）"}`, "");
    entries.forEach((entry, index) => {
      const label = String.fromCharCode(65 + index);
      const targetName = `${test.id}-${label}.md`;
      fs.writeFileSync(path.join(outputRoot, targetName), entry.anonymousText, "utf8");
      privateMap.tests[test.id][label] = { candidateId: entry.candidate.id, reference: entry.candidate.reference === true, sourceSha256: sha256(entry.rawText), anonymousSha256: sha256(entry.anonymousText) };
      review.push(`- ${label}：硬失败 PASS/FAIL；相对另一稿的偏好：；证据原句：；主要损失：；最多一次局部返修：`);
      totalCandidates += 1;
    });
    review.push("");
  }

  review.push("## 最终结论", "", "- 各任务两两偏好：", "- 质量差异是否达到可感阈值：", "- 实际积分差：", "- 是否满足三轮晋升条件：否（单轮不得晋升）", "");
  fs.writeFileSync(path.join(outputRoot, "review-sheet.md"), review.join("\n"), "utf8");
  fs.writeFileSync(privateMapPath, `${JSON.stringify(privateMap, null, 2)}\n`, "utf8");
  return { outDir: outputRoot, mapPath: privateMapPath, tests: selected.length, candidates: totalCandidates, comparisonReady: selected.every((test) => Object.keys(privateMap.tests[test.id]).length >= 2) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.raw || !args.out || !args.map || !args.seed) throw new Error("Required: --raw <dir> --out <dir> --map <file> --seed <value> [--test <id[,id]>] [--reference <file>]");
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const plan = JSON.parse(fs.readFileSync(path.resolve(scriptDir, "../../09-evals/blind-test-plan.json"), "utf8"));
  const testIds = args.test ? args.test.split(",").map((item) => item.trim()).filter(Boolean) : null;
  const reference = args.reference ? { testId: testIds?.[0], id: "local-reference", path: args.reference } : null;
  const result = buildBlindPack({ plan, rawDir: args.raw, outDir: args.out, mapPath: args.map, seed: args.seed, testIds, reference });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
