#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function duplicates(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function sameSet(left, right) {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

export function evaluatePilotBatch({ registry, calibration, chapters, batchAudit, batchAcceptance, surface, modelName }) {
  const failures = [];
  const route = (registry?.routes || []).find((item) => item.surface === surface && item.modelName === modelName) || null;
  if (!route) failures.push({ code: "UNREGISTERED_PILOT_ROUTE", surface, modelName });
  if (route && (route.status !== "PILOT" || route.allowedAutonomy !== "PILOT")) failures.push({ code: "ROUTE_NOT_IN_PILOT_STAGE", status: route.status || null, allowedAutonomy: route.allowedAutonomy || null });
  if (route && (Number(route.sameClassPasses || 0) < Number(route.requiredPasses || 3) || route.humanVoiceAccepted !== true || route.automaticRetry !== false)) failures.push({ code: "PILOT_CALIBRATION_STATE_INVALID" });
  if (!calibration?.path || !/^[a-f0-9]{64}$/u.test(calibration?.sha256 || "") || calibration?.value?.decision !== "ELIGIBLE_FOR_PILOT" || calibration?.value?.surface !== surface || calibration?.value?.modelName !== modelName) failures.push({ code: "CALIBRATION_GATE_BINDING_INVALID" });

  const receipts = Array.isArray(chapters) ? chapters : [];
  if (receipts.length < 5 || receipts.length > 10) failures.push({ code: "PILOT_CHAPTER_COUNT_OUT_OF_RANGE", actual: receipts.length, min: 5, max: 10 });
  for (const item of receipts) {
    const value = item?.value;
    if (!item?.path || !/^[a-f0-9]{64}$/u.test(item?.sha256 || "")) failures.push({ code: "INVALID_CHAPTER_RECEIPT_BINDING", path: item?.path || null });
    if (value?.decision !== "READY_FOR_BATCH_REVIEW" || value?.status !== "success" || value?.eligibleForCanonCommit !== false || (value?.failures || []).length || (value?.warnings || []).length) failures.push({ code: "CHAPTER_NOT_CLEAN_PILOT_CANDIDATE", chapterId: value?.chapterId || null });
    if (value?.route?.surface !== surface || value?.route?.modelName !== modelName || value?.route?.status !== "PILOT") failures.push({ code: "CHAPTER_ROUTE_MISMATCH", chapterId: value?.chapterId || null });
    if (!/^[a-f0-9]{64}$/u.test(value?.artifacts?.finalDraft?.sha256 || "")) failures.push({ code: "FINAL_DRAFT_HASH_MISSING", chapterId: value?.chapterId || null });
    const actualCredits = Number(value?.cost?.actualCredits);
    if (!Number.isFinite(actualCredits) || actualCredits < 0) failures.push({ code: "INVALID_CHAPTER_COST", chapterId: value?.chapterId || null, actualCredits: value?.cost?.actualCredits ?? null });
  }
  for (const [field, values] of Object.entries({ CHAPTER_ID: receipts.map((item) => item.value?.chapterId), RUN_ID: receipts.map((item) => item.value?.runId), SCENARIO_ID: receipts.map((item) => item.value?.scenarioId), FINAL_DRAFT: receipts.map((item) => item.value?.artifacts?.finalDraft?.sha256) })) {
    const repeated = duplicates(values.filter(Boolean));
    if (repeated.length || values.some((value) => !value)) failures.push({ code: `DUPLICATE_OR_MISSING_${field}`, evidence: repeated });
  }

  const receiptHashes = receipts.map((item) => item.sha256);
  const draftHashes = receipts.map((item) => item.value?.artifacts?.finalDraft?.sha256).filter(Boolean);
  const totalCredits = receipts.reduce((sum, item) => sum + Number(item.value?.cost?.actualCredits), 0);
  const maxBatchCredits = receipts.length * Number(route?.maxCreditsPerRun || 0);
  if (!Number.isFinite(totalCredits) || !Number.isFinite(maxBatchCredits) || maxBatchCredits <= 0 || totalCredits > maxBatchCredits) failures.push({ code: "PILOT_BATCH_COST_INVALID", totalCredits, maxBatchCredits });

  if (batchAudit?.version !== 1 || batchAudit?.decision !== "PASS") failures.push({ code: "BATCH_AUDIT_NOT_PASS" });
  if (!sameSet(batchAudit?.chapterReceiptSha256s || [], receiptHashes) || !sameSet(batchAudit?.finalDraftSha256s || [], draftHashes)) failures.push({ code: "BATCH_AUDIT_HASH_SET_MISMATCH" });
  if (!new Set(["NO_AUTOMATIC_SIGNAL", "INDEPENDENT_REVIEW_CLEARED"]).has(batchAudit?.crossChapterFingerprintDecision)) failures.push({ code: "CROSS_CHAPTER_FINGERPRINT_NOT_CLEARED" });
  if (batchAudit?.crossChapterFingerprintDecision === "INDEPENDENT_REVIEW_CLEARED" && !(batchAudit?.reviewEvidenceRefs || []).length) failures.push({ code: "CROSS_CHAPTER_REVIEW_EVIDENCE_MISSING" });
  if (batchAudit?.storyDebtDecision !== "PASS") failures.push({ code: "STORY_DEBT_NOT_CLEARED" });
  if (batchAudit?.voiceDriftDecision !== "PASS") failures.push({ code: "VOICE_DRIFT_NOT_CLEARED" });
  if (Number(batchAudit?.p0Count) !== 0) failures.push({ code: "PILOT_P0_PRESENT", count: batchAudit?.p0Count ?? null });
  if (Number(batchAudit?.consecutiveExperienceReturns) >= 2 || Number(batchAudit?.consecutiveExperienceReturns) < 0) failures.push({ code: "CONSECUTIVE_EXPERIENCE_RETURNS", count: batchAudit?.consecutiveExperienceReturns ?? null });
  if (Number(batchAudit?.totalCredits) !== totalCredits) failures.push({ code: "BATCH_TOTAL_CREDITS_MISMATCH", expected: totalCredits, actual: batchAudit?.totalCredits ?? null });

  if (batchAcceptance?.version !== 1 || batchAcceptance?.scope !== "PILOT_BATCH" || batchAcceptance?.accepted !== true || !batchAcceptance?.acceptedAt || !batchAcceptance?.evidenceRef?.trim()) failures.push({ code: "PILOT_BATCH_ACCEPTANCE_MISSING" });
  if (batchAcceptance?.surface !== surface || batchAcceptance?.modelName !== modelName) failures.push({ code: "PILOT_BATCH_ACCEPTANCE_ROUTE_MISMATCH" });
  if (!sameSet(batchAcceptance?.chapterReceiptSha256s || [], receiptHashes)) failures.push({ code: "PILOT_BATCH_ACCEPTANCE_HASH_SET_MISMATCH" });

  const decision = failures.length ? "PILOT_BATCH_REJECT" : "ELIGIBLE_FOR_PRODUCTION_PENDING_RECEIPT_HASH";
  return {
    status: failures.length ? "error" : "success",
    summary: decision,
    decision,
    surface,
    modelName,
    chapterCount: receipts.length,
    cost: { totalCredits, maxBatchCredits, averageCreditsPerChapter: receipts.length ? Number((totalCredits / receipts.length).toFixed(3)) : null },
    evidence: { calibration: { path: calibration?.path || null, sha256: calibration?.sha256 || null }, chapters: receipts.map((item) => ({ path: item.path, sha256: item.sha256, chapterId: item.value?.chapterId })), batchAuditSha256: sha256(JSON.stringify(batchAudit)), batchAcceptanceSha256: sha256(JSON.stringify(batchAcceptance)) },
    proposedRoutePatchBeforePersist: failures.length ? null : { status: "PRODUCTION", allowedAutonomy: "PRODUCTION", pilotBatchPass: true, automaticRetry: false, promotionEvidence: [...(route.promotionEvidence || []), { kind: "calibration-gate", path: calibration.path, sha256: calibration.sha256 }] },
    requiredAfterPersist: failures.length ? null : { kind: "pilot-batch", instruction: "Save this complete gate output, compute its file SHA-256, append path and hash to promotionEvidence, then rerun topology before applying the PRODUCTION route." },
    failures,
    next_actions: failures.length ? ["Return to PILOT or CALIBRATION according to the named failure; do not retry or promote automatically."] : ["Persist this receipt, append its path/hash as pilot-batch promotion evidence, apply the proposed route patch, and require a topology PASS before PRODUCTION use."],
    note: "This gate never writes the registry. A production patch is incomplete until the saved pilot-batch receipt hash is attached and topology passes."
  };
}

function parseArgs(argv) {
  const values = { chapters: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--chapter") values.chapters.push(argv[++index]);
    else if (argv[index]?.startsWith("--") && argv[index + 1] !== undefined) values[argv[index].slice(2)] = argv[++index];
    else throw new Error("usage: --registry <json> --calibration <json> --audit <json> --acceptance <json> --surface <id> --model <id> --chapter <json> ...");
  }
  for (const key of ["registry", "calibration", "audit", "acceptance", "surface", "model"]) if (!values[key]) throw new Error("usage: --registry <json> --calibration <json> --audit <json> --acceptance <json> --surface <id> --model <id> --chapter <json> ...");
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  const bound = (file) => { const text = fs.readFileSync(path.resolve(file), "utf8"); return { path: file, sha256: sha256(text), value: JSON.parse(text) }; };
  const result = evaluatePilotBatch({ registry: JSON.parse(fs.readFileSync(path.resolve(args.registry), "utf8")), calibration: bound(args.calibration), chapters: args.chapters.map(bound), batchAudit: JSON.parse(fs.readFileSync(path.resolve(args.audit), "utf8")), batchAcceptance: JSON.parse(fs.readFileSync(path.resolve(args.acceptance), "utf8")), surface: args.surface, modelName: args.model });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.decision !== "ELIGIBLE_FOR_PRODUCTION_PENDING_RECEIPT_HASH") process.exitCode = 2;
}
