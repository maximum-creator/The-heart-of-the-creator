#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const QUALITY_DIMENSIONS = [
  "readerPull",
  "characterAgency",
  "causalProcess",
  "emotionalAftertaste",
  "voiceSpecificity",
];

const REVIEW_MARKERS = [
  "blind-review.template.json",
  "blind-review-gate.mjs",
  "reviewVersion: 2",
  "anonymousCandidateId",
  "mainLoss",
];

const REVISION_MARKERS = ["mainLoss", "concernEvidence", "frozenRanges", "一次只处理一个 mainLoss"];
const REVISION_TEMPLATE_MARKERS = [
  "blindReviewReceiptSha256",
  "anonymousCandidateId",
  "mainLoss",
  "concernEvidence",
  "targetRanges",
  "frozenRanges",
  "preservedFacts",
  "changeBudget",
  "postRevisionChecks",
];
const ACTIVATION_MARKERS = ["CALIBRATION", "PILOT", "数据异常"];
const PROSE_FORBIDDEN_MARKERS = [
  ...QUALITY_DIMENSIONS,
  "blind-review.template.json",
  "blind-review-gate.mjs",
  "reviewVersion: 2",
  "anonymousCandidateId",
  "mainLoss",
];

function missingMarkers(text, markers) {
  return markers.filter((marker) => !text.includes(marker));
}

export function validateReviewContractRouting(documents) {
  const errors = [];
  const editor = documents?.editor || "";
  const director = documents?.director || "";
  const revision = documents?.revision || "";
  const revisionTemplate = documents?.revisionTemplate || "";

  for (const marker of missingMarkers(editor, [...REVIEW_MARKERS, ...QUALITY_DIMENSIONS])) {
    errors.push(`editor missing ${marker}`);
  }
  if (!/作者.*审稿|审稿.*作者/u.test(editor) || !/(不得|不能|禁止)/u.test(editor)) {
    errors.push("editor missing author-reviewer separation");
  }

  for (const marker of missingMarkers(director, REVIEW_MARKERS)) {
    errors.push(`director missing ${marker}`);
  }
  if (!ACTIVATION_MARKERS.some((marker) => director.includes(marker))) {
    errors.push("director missing activation boundary");
  }
  if (!director.includes("不得用总分")) {
    errors.push("director missing score-override prohibition");
  }

  for (const marker of missingMarkers(revision, REVISION_MARKERS)) {
    errors.push(`revision missing ${marker}`);
  }
  if (!revision.includes("不得整章重写")) {
    errors.push("revision missing full-rewrite prohibition");
  }
  for (const marker of missingMarkers(revisionTemplate, REVISION_TEMPLATE_MARKERS)) {
    errors.push(`revisionTemplate missing ${marker}`);
  }

  for (const surface of ["proseWriter", "chapterWriting"]) {
    const text = documents?.[surface] || "";
    for (const marker of PROSE_FORBIDDEN_MARKERS.filter((item) => text.includes(item))) {
      errors.push(`${surface} leaks ${marker}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function rootPath(repositoryRoot) {
  if (repositoryRoot instanceof URL) return fileURLToPath(repositoryRoot);
  return path.resolve(repositoryRoot);
}

export async function inspectReviewContractRouting(repositoryRoot) {
  const root = rootPath(repositoryRoot);
  const paths = {
    editor: ".feelfish/agents/novelos-narrative-editor.md",
    director: ".feelfish/agents/novelos-director.md",
    revision: ".feelfish/skills/novelos-surgical-revision/SKILL.md",
    revisionTemplate: ".feelfish/skills/novelos-surgical-revision/assets/revision-order-template.md",
    proseWriter: ".feelfish/agents/novelos-prose-writer.md",
    chapterWriting: ".feelfish/skills/novelos-chapter-writing/SKILL.md",
  };
  const entries = await Promise.all(
    Object.entries(paths).map(async ([name, relativePath]) => [name, await readFile(path.join(root, relativePath), "utf8")]),
  );
  return validateReviewContractRouting(Object.fromEntries(entries));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const repositoryRoot = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const result = await inspectReviewContractRouting(repositoryRoot);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}
