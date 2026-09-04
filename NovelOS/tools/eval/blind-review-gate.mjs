#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HARD_DECISIONS = new Set(["PASS", "FAIL"]);
const REPAIR_SCOPES = new Set(["NONE", "LOCAL", "STRUCTURAL"]);
const PREFERENCES = new Set(["LEFT", "RIGHT", "TIE"]);
const DIFFERENCES = new Set(["PERCEPTIBLE", "NOT_PERCEPTIBLE"]);
const DIMENSION_DECISIONS = new Set(["PASS", "CONCERN"]);
const QUALITY_DIMENSIONS = ["readerPull", "characterAgency", "causalProcess", "emotionalAftertaste", "voiceSpecificity"];

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function pairKey(left, right) {
  return [left, right].sort().join("|");
}

function validQuote(text, quote) {
  const value = typeof quote === "string" ? quote.trim() : "";
  return [...value].length >= 4 && [...value].length <= 120 && text.includes(value);
}

function listAnonymousCandidates(directory, testId) {
  const escaped = testId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}-([A-Z])\\.md$`, "u");
  return fs.readdirSync(directory).map((name) => ({ name, match: name.match(pattern) })).filter((item) => item.match).map((item) => {
    const text = fs.readFileSync(path.join(directory, item.name), "utf8");
    return { label: item.match[1], path: item.name, sha256: sha256(text), text };
  }).sort((a, b) => a.label.localeCompare(b.label));
}

export function evaluateBlindReview({ review, anonymousDir }) {
  const failures = [];
  if (review?.version !== 2) failures.push({ code: "UNSUPPORTED_REVIEW_VERSION", actual: review?.version ?? null });
  if (!review?.testId?.trim()) failures.push({ code: "MISSING_TEST_ID" });
  if (review?.hiddenIdentityConfirmed !== true) failures.push({ code: "IDENTITY_NOT_CONFIRMED_HIDDEN" });
  if (review?.costsHiddenDuringReview !== true) failures.push({ code: "COST_BIAS_NOT_HIDDEN" });

  let artifacts = [];
  try {
    artifacts = listAnonymousCandidates(path.resolve(anonymousDir), review?.testId || "");
  } catch (error) {
    failures.push({ code: "ANONYMOUS_PACK_LOAD_FAILED", evidence: error.message });
  }
  if (artifacts.length < 2) failures.push({ code: "PAIRWISE_COMPARISON_NOT_READY", count: artifacts.length });
  const labels = artifacts.map((item) => item.label);
  const artifactByLabel = new Map(artifacts.map((item) => [item.label, item]));

  const candidateReviews = Array.isArray(review?.candidates) ? review.candidates : [];
  if (candidateReviews.length !== labels.length || new Set(candidateReviews.map((item) => item.label)).size !== candidateReviews.length) failures.push({ code: "CANDIDATE_REVIEW_SET_MISMATCH", expected: labels, actual: candidateReviews.map((item) => item.label) });
  for (const item of candidateReviews) {
    const artifact = artifactByLabel.get(item.label);
    if (!artifact) {
      failures.push({ code: "UNKNOWN_CANDIDATE_LABEL", label: item.label || null });
      continue;
    }
    if (!HARD_DECISIONS.has(item.hardDecision)) failures.push({ code: "INVALID_HARD_DECISION", label: item.label });
    if (!REPAIR_SCOPES.has(item.repairScope)) failures.push({ code: "INVALID_REPAIR_SCOPE", label: item.label });
    if (typeof item.mainLoss !== "string" || !item.mainLoss.trim()) failures.push({ code: "MISSING_MAIN_LOSS", label: item.label });
    if (!Array.isArray(item.evidenceQuotes) || !item.evidenceQuotes.length || item.evidenceQuotes.some((quote) => !validQuote(artifact.text, quote))) failures.push({ code: "UNGROUNDED_CANDIDATE_EVIDENCE", label: item.label });
    const dimensions = item?.dimensions && typeof item.dimensions === "object" && !Array.isArray(item.dimensions) ? item.dimensions : {};
    for (const key of Object.keys(dimensions)) if (!QUALITY_DIMENSIONS.includes(key)) failures.push({ code: "UNKNOWN_QUALITY_DIMENSION", label: item.label, dimension: key });
    const groundedQuotes = [];
    for (const dimension of QUALITY_DIMENSIONS) {
      const judgment = dimensions[dimension];
      if (!judgment) {
        failures.push({ code: "MISSING_QUALITY_DIMENSION", label: item.label, dimension });
        continue;
      }
      if (!DIMENSION_DECISIONS.has(judgment.decision)) failures.push({ code: "INVALID_DIMENSION_DECISION", label: item.label, dimension, actual: judgment.decision ?? null });
      if (!validQuote(artifact.text, judgment.evidenceQuote)) failures.push({ code: "UNGROUNDED_DIMENSION_EVIDENCE", label: item.label, dimension });
      else groundedQuotes.push(judgment.evidenceQuote.trim());
      if (typeof judgment.rationale !== "string" || [...judgment.rationale.trim()].length < 8) failures.push({ code: "DIMENSION_RATIONALE_TOO_THIN", label: item.label, dimension });
    }
    if (groundedQuotes.length === QUALITY_DIMENSIONS.length && new Set(groundedQuotes).size < 3) failures.push({ code: "DIMENSION_EVIDENCE_TOO_NARROW", label: item.label, uniqueQuotes: new Set(groundedQuotes).size });
  }

  const expectedPairs = [];
  for (let left = 0; left < labels.length; left += 1) for (let right = left + 1; right < labels.length; right += 1) expectedPairs.push(pairKey(labels[left], labels[right]));
  const pairwise = Array.isArray(review?.pairwise) ? review.pairwise : [];
  const actualPairs = pairwise.map((item) => pairKey(item.left, item.right));
  if (pairwise.length !== expectedPairs.length || new Set(actualPairs).size !== pairwise.length || expectedPairs.some((item) => !actualPairs.includes(item))) failures.push({ code: "PAIRWISE_SET_INCOMPLETE", expected: expectedPairs, actual: actualPairs });
  for (const item of pairwise) {
    if (!artifactByLabel.has(item.left) || !artifactByLabel.has(item.right) || item.left === item.right) failures.push({ code: "INVALID_PAIR_LABELS", pair: [item.left, item.right] });
    if (!PREFERENCES.has(item.preference)) failures.push({ code: "INVALID_PAIR_PREFERENCE", pair: [item.left, item.right] });
    if (!DIFFERENCES.has(item.difference)) failures.push({ code: "INVALID_DIFFERENCE_JUDGMENT", pair: [item.left, item.right] });
    if (item.preference === "TIE" && item.difference !== "NOT_PERCEPTIBLE") failures.push({ code: "TIE_MARKED_PERCEPTIBLE", pair: [item.left, item.right] });
    if (typeof item.rationale !== "string" || [...item.rationale.trim()].length < 12) failures.push({ code: "RATIONALE_TOO_THIN", pair: [item.left, item.right] });
    const evidence = Array.isArray(item.evidence) ? item.evidence : [];
    for (const label of [item.left, item.right]) {
      const grounded = evidence.some((entry) => entry.label === label && validQuote(artifactByLabel.get(label)?.text || "", entry.quote));
      if (!grounded) failures.push({ code: "PAIR_EVIDENCE_MISSING", pair: [item.left, item.right], label });
    }
  }

  const hardFailures = candidateReviews.filter((item) => item.hardDecision === "FAIL").map((item) => item.label);
  const decision = failures.length ? "REJECT_REVIEW_RECEIPT" : hardFailures.length ? "BLIND_REVIEW_LOCKED_WITH_HARD_FAILURE" : "BLIND_REVIEW_LOCKED";
  return {
    status: failures.length ? "error" : "success",
    summary: decision,
    decision,
    testId: review?.testId || null,
    reviewSha256: sha256(JSON.stringify(review)),
    artifacts: artifacts.map(({ text, ...item }) => item),
    hardFailures,
    failures,
    next_actions: failures.length ? ["Correct only the missing or ungrounded review evidence; do not reveal the private identity map."] : ["Persist this locked receipt, then reveal the private map and join actual cost evidence in a separate routing decision."],
    note: "This gate proves that a blind comparison is complete and text-grounded. It does not decide taste, reveal identity, or promote a route."
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error("usage: --review <json> --anonymous <directory>");
    values[argv[index].slice(2)] = argv[index + 1];
  }
  if (!values.review || !values.anonymous) throw new Error("usage: --review <json> --anonymous <directory>");
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  const result = evaluateBlindReview({ review: JSON.parse(fs.readFileSync(path.resolve(args.review), "utf8")), anonymousDir: path.resolve(args.anonymous) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.decision === "REJECT_REVIEW_RECEIPT") process.exitCode = 2;
}
