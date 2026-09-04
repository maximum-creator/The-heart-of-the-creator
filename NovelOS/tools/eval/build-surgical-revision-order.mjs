#!/usr/bin/env node

import crypto from "node:crypto";

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalLines(text) {
  return text.replace(/\r\n?/gu, "\n").split("\n");
}

function locateQuote(lines, quote) {
  const text = lines.join("\n");
  const offset = text.indexOf(quote);
  if (offset < 0) return null;
  const startLine = text.slice(0, offset).split("\n").length;
  const endLine = startLine + quote.split("\n").length - 1;
  return { startLine, endLine };
}

function mergeRanges(ranges) {
  const sorted = ranges
    .map((range) => ({ ...range }))
    .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.startLine <= previous.endLine + 1) previous.endLine = Math.max(previous.endLine, range.endLine);
    else merged.push(range);
  }
  return merged;
}

function complementRanges(targetRanges, lineCount) {
  const frozen = [];
  let cursor = 1;
  for (const range of targetRanges) {
    if (cursor < range.startLine) frozen.push({ startLine: cursor, endLine: range.startLine - 1 });
    cursor = range.endLine + 1;
  }
  if (cursor <= lineCount) frozen.push({ startLine: cursor, endLine: lineCount });
  return frozen;
}

function uniqueConcernEvidence(candidate) {
  const evidence = [];
  const seen = new Set();
  for (const [dimension, judgment] of Object.entries(candidate.dimensions || {})) {
    if (judgment?.decision !== "CONCERN" || typeof judgment.evidenceQuote !== "string") continue;
    const quote = judgment.evidenceQuote.trim();
    if (!quote || seen.has(quote)) continue;
    seen.add(quote);
    evidence.push({ dimension, quote, rationale: judgment.rationale });
  }
  return evidence;
}

export function buildSurgicalRevisionOrder({
  review,
  receipt,
  candidateLabel,
  candidateText,
  preservedFacts = [],
}) {
  if (!review || !receipt || typeof candidateText !== "string") throw new Error("review, receipt and candidate text are required");
  if (!candidateLabel?.trim()) throw new Error("candidate label is required");
  if (!new Set(["BLIND_REVIEW_LOCKED", "BLIND_REVIEW_LOCKED_WITH_HARD_FAILURE"]).has(receipt.decision)) {
    throw new Error("blind review receipt is not locked");
  }
  if (receipt.testId !== review.testId) throw new Error("test identity mismatch between review and receipt");
  if (receipt.reviewSha256 !== sha256(JSON.stringify(review))) throw new Error("review receipt does not bind the supplied review");

  const candidate = review.candidates?.find((item) => item.label === candidateLabel);
  const artifact = receipt.artifacts?.find((item) => item.label === candidateLabel);
  if (!candidate || !artifact) throw new Error("anonymous candidate is absent from review receipt");
  if (artifact.sha256 !== sha256(candidateText)) throw new Error("candidate text hash mismatch after blind review");
  if (candidate.hardDecision !== "PASS") throw new Error("cannot narratively revise a hard-failed candidate");

  if (candidate.mainLoss === "NONE" && candidate.repairScope === "NONE") {
    return { decision: "NO_REVISION_REQUIRED", order: null };
  }
  if (candidate.repairScope === "STRUCTURAL") {
    return { decision: "ESCALATE_TO_ARCHITECT", order: null, mainLoss: candidate.mainLoss };
  }
  if (candidate.repairScope !== "LOCAL" || !candidate.mainLoss?.trim() || candidate.mainLoss === "NONE") {
    throw new Error("local revision requires exactly one non-empty main loss");
  }

  const lines = canonicalLines(candidateText);
  const quotes = Array.isArray(candidate.evidenceQuotes) ? candidate.evidenceQuotes.map((value) => value?.trim()).filter(Boolean) : [];
  if (!quotes.length) throw new Error("ungrounded revision evidence: no candidate quotes");
  const located = quotes.map((quote) => locateQuote(lines, quote));
  if (located.some((range) => range === null)) throw new Error("ungrounded revision evidence cannot locate an allowed target range");
  const targetRanges = mergeRanges(located);
  const facts = Array.isArray(preservedFacts) ? preservedFacts.map((item) => String(item).trim()).filter(Boolean) : [];

  return {
    decision: "REVISION_ORDER_READY",
    order: {
      blindReviewReceiptSha256: sha256(JSON.stringify(receipt)),
      anonymousCandidateId: candidateLabel,
      candidateSha256: artifact.sha256,
      mainLoss: candidate.mainLoss,
      concernEvidence: uniqueConcernEvidence(candidate),
      targetRanges,
      frozenRanges: complementRanges(targetRanges, lines.length),
      preservedFacts: facts,
      changeBudget: { maxPasses: 1, maxTargetRanges: targetRanges.length, fullRewrite: false },
      forbiddenAdditions: ["new Canon", "new professional fact", "new ability", "new relationship turn", "new solution mechanism"],
      postRevisionChecks: ["fact continuity", "limited point of view", "character agency", "causal process", "cross-chapter repetition"],
    },
  };
}
