#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function sorted(value) {
  return [...value].sort((a, b) => a.localeCompare(b));
}

function winnerLabel(pair) {
  if (pair.preference === "LEFT") return pair.left;
  if (pair.preference === "RIGHT") return pair.right;
  return null;
}

export function evaluateRouteTrial({ review, lockedReview, privateMap, registry, run, referenceId = "local-reference" }) {
  const failures = [];
  if (lockedReview?.decision !== "BLIND_REVIEW_LOCKED" && lockedReview?.decision !== "BLIND_REVIEW_LOCKED_WITH_HARD_FAILURE") failures.push({ code: "BLIND_REVIEW_NOT_LOCKED", actual: lockedReview?.decision || null });
  if (lockedReview?.reviewSha256 !== sha256(JSON.stringify(review))) failures.push({ code: "LOCKED_REVIEW_HASH_MISMATCH" });
  if (review?.testId !== run?.testId || lockedReview?.testId !== run?.testId) failures.push({ code: "TEST_ID_MISMATCH", review: review?.testId || null, locked: lockedReview?.testId || null, run: run?.testId || null });

  const route = (registry?.routes || []).find((item) => item.surface === run?.surface && item.modelName === run?.modelName) || null;
  if (!route) failures.push({ code: "UNREGISTERED_TRIAL_ROUTE", surface: run?.surface || null, modelName: run?.modelName || null });
  if (route?.automaticRetry !== false || run?.automaticRetry !== false || Number(run?.retryCount) !== 0) failures.push({ code: "RETRY_DISQUALIFIES_STABILITY", routeAutomaticRetry: route?.automaticRetry ?? null, runAutomaticRetry: run?.automaticRetry ?? null, retryCount: run?.retryCount ?? null });
  const numericFields = ["inputTokens", "outputTokens", "outputChars", "actualCredits"];
  const invalidNumbers = numericFields.filter((field) => !Number.isFinite(Number(run?.[field])) || (field === "actualCredits" ? Number(run[field]) < 0 : Number(run[field]) <= 0));
  if (invalidNumbers.length || !run?.runId || !run?.scenarioId || !run?.billingEvidenceRef?.trim() || !/^[a-f0-9]{64}$/u.test(run?.rawResponseSha256 || "")) failures.push({ code: "INCOMPLETE_IMMUTABLE_RUN_EVIDENCE", fields: invalidNumbers });
  if (route && (!Number.isFinite(Number(route.maxCreditsPerRun)) || Number(route.maxCreditsPerRun) <= 0)) failures.push({ code: "INVALID_ROUTE_COST_ENVELOPE" });
  else if (route && Number(run?.actualCredits) > Number(route.maxCreditsPerRun)) failures.push({ code: "TRIAL_COST_ENVELOPE_EXCEEDED", actualCredits: Number(run.actualCredits), maxCredits: Number(route.maxCreditsPerRun) });

  const mapEntries = privateMap?.tests?.[run?.testId] || null;
  const artifactEntries = Array.isArray(lockedReview?.artifacts) ? lockedReview.artifacts : [];
  const mapLabels = mapEntries ? Object.keys(mapEntries) : [];
  const artifactLabels = artifactEntries.map((item) => item.label);
  if (privateMap?.version !== 2 || !mapEntries) failures.push({ code: "PRIVATE_MAP_TEST_MISSING" });
  if (JSON.stringify(sorted(mapLabels)) !== JSON.stringify(sorted(artifactLabels))) failures.push({ code: "MAP_ARTIFACT_LABEL_MISMATCH", mapLabels, artifactLabels });
  for (const artifact of artifactEntries) {
    if (mapEntries?.[artifact.label]?.anonymousSha256 !== artifact.sha256) failures.push({ code: "ANONYMOUS_ARTIFACT_HASH_MISMATCH", label: artifact.label });
  }
  const identities = mapLabels.map((label) => mapEntries[label]?.candidateId).filter(Boolean);
  if (new Set(identities).size !== identities.length) failures.push({ code: "DUPLICATE_REVEALED_IDENTITY" });
  const candidateLabel = mapLabels.find((label) => mapEntries[label]?.candidateId === run?.modelName) || null;
  const referenceLabel = mapLabels.find((label) => mapEntries[label]?.candidateId === referenceId) || null;
  if (!candidateLabel) failures.push({ code: "RUN_MODEL_NOT_IN_PRIVATE_MAP", modelName: run?.modelName || null });
  if (!referenceLabel) failures.push({ code: "REFERENCE_NOT_IN_PRIVATE_MAP", referenceId });
  if (candidateLabel && mapEntries[candidateLabel]?.sourceSha256 !== run.rawResponseSha256) failures.push({ code: "RAW_RESPONSE_HASH_MISMATCH", expected: mapEntries[candidateLabel]?.sourceSha256 || null, actual: run.rawResponseSha256 || null });

  const candidateReview = (review?.candidates || []).find((item) => item.label === candidateLabel) || null;
  const referenceReview = (review?.candidates || []).find((item) => item.label === referenceLabel) || null;
  const pair = (review?.pairwise || []).find((item) => new Set([item.left, item.right]).size === 2 && [item.left, item.right].includes(candidateLabel) && [item.left, item.right].includes(referenceLabel)) || null;
  if (!candidateReview || !referenceReview || !pair) failures.push({ code: "REVEALED_REVIEW_BINDING_MISSING" });
  const expectedHardFailures = sorted((review?.candidates || []).filter((item) => item.hardDecision === "FAIL").map((item) => item.label));
  const lockedHardFailures = sorted(Array.isArray(lockedReview?.hardFailures) ? lockedReview.hardFailures : []);
  if (JSON.stringify(expectedHardFailures) !== JSON.stringify(lockedHardFailures)) failures.push({ code: "LOCKED_HARD_FAILURE_SET_MISMATCH", expected: expectedHardFailures, actual: lockedHardFailures });
  if (referenceReview?.hardDecision === "FAIL") failures.push({ code: "REFERENCE_HARD_FAILURE_INVALIDATES_TRIAL" });

  let comparison = null;
  if (pair) {
    const winner = winnerLabel(pair);
    comparison = pair.difference === "NOT_PERCEPTIBLE" || pair.preference === "TIE"
      ? "REFERENCE_PARITY"
      : winner === candidateLabel
        ? "PERCEPTIBLE_WIN"
        : "PERCEPTIBLE_LOSS";
  }
  const costPerOutputChar = Number(run?.outputChars) > 0 ? Number((Number(run.actualCredits) / Number(run.outputChars)).toFixed(6)) : null;
  let decision;
  let countsTowardStability = false;
  if (failures.length) decision = "REJECT_TRIAL_EVIDENCE";
  else if (candidateReview.hardDecision === "FAIL") decision = "TRIAL_FAIL_HARD";
  else if (comparison === "PERCEPTIBLE_LOSS") decision = "TRIAL_FAIL_QUALITY";
  else if (candidateReview.repairScope === "STRUCTURAL") decision = "TRIAL_FAIL_STRUCTURAL_REPAIR";
  else if (candidateReview.repairScope === "LOCAL") decision = "TRIAL_PASS_REPAIR_REQUIRED";
  else {
    decision = comparison === "PERCEPTIBLE_WIN" ? "TRIAL_PASS_PERCEPTIBLE_WIN" : "TRIAL_PASS_REFERENCE_PARITY";
    countsTowardStability = true;
  }

  return {
    status: failures.length || decision.startsWith("TRIAL_FAIL") ? "error" : decision === "TRIAL_PASS_REPAIR_REQUIRED" ? "warning" : "success",
    summary: decision,
    decision,
    countsTowardStability,
    promotable: false,
    testId: run?.testId || null,
    runId: run?.runId || null,
    scenarioId: run?.scenarioId || null,
    modelName: run?.modelName || null,
    revealedLabels: { candidate: candidateLabel, reference: referenceLabel },
    comparison,
    repairScope: candidateReview?.repairScope || null,
    cost: { actualCredits: Number.isFinite(Number(run?.actualCredits)) ? Number(run.actualCredits) : null, outputChars: Number.isFinite(Number(run?.outputChars)) ? Number(run.outputChars) : null, creditsPerOutputChar: costPerOutputChar, maxCreditsPerRun: route ? Number(route.maxCreditsPerRun) : null },
    evidenceHashes: { review: lockedReview?.reviewSha256 || null, rawResponse: run?.rawResponseSha256 || null, anonymousCandidate: candidateLabel ? mapEntries?.[candidateLabel]?.anonymousSha256 || null : null },
    failures,
    next_actions: countsTowardStability ? ["Append this immutable receipt to the route evidence ledger; do not edit sameClassPasses directly or promote from one run."] : decision === "TRIAL_PASS_REPAIR_REQUIRED" ? ["Record the local repair and rerun a different same-class task; this trial does not count toward stability."] : ["Stop this route trial and diagnose the named evidence, quality, retry or cost failure before requesting another paid run."],
    note: "A trial receipt never promotes a route. Stability requires three distinct qualifying receipts plus one whole-voice acceptance and an aggregate promotion gate."
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error("usage: --review <json> --locked <json> --map <json> --registry <json> --run <json> [--reference-id <id>]");
    result[argv[index].slice(2)] = argv[index + 1];
  }
  for (const key of ["review", "locked", "map", "registry", "run"]) if (!result[key]) throw new Error("usage: --review <json> --locked <json> --map <json> --registry <json> --run <json> [--reference-id <id>]");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  const read = (name) => JSON.parse(fs.readFileSync(path.resolve(args[name]), "utf8"));
  const result = evaluateRouteTrial({ review: read("review"), lockedReview: read("locked"), privateMap: read("map"), registry: read("registry"), run: read("run"), referenceId: args["reference-id"] || "local-reference" });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.countsTowardStability) process.exitCode = 2;
}
