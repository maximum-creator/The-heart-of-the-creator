#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function duplicateValues(items, field) {
  const values = items.map((item) => item.value?.[field]).filter(Boolean);
  return values.filter((value, index) => values.indexOf(value) !== index);
}

export function evaluateRouteCalibration({ registry, trials, voice, surface, modelName }) {
  const failures = [];
  const route = (registry?.routes || []).find((item) => item.surface === surface && item.modelName === modelName) || null;
  if (!route) failures.push({ code: "UNREGISTERED_CALIBRATION_ROUTE", surface, modelName });
  if (route && !new Set(["CANDIDATE", "CHALLENGER", "BASELINE"]).has(route.status)) failures.push({ code: "ROUTE_NOT_IN_CALIBRATION_STAGE", actual: route.status });
  if (route && route.allowedAutonomy !== "CALIBRATION") failures.push({ code: "CALIBRATION_AUTONOMY_MISMATCH", actual: route.allowedAutonomy || null });
  const requiredPasses = Number(route?.requiredPasses || 0);
  if (!Number.isInteger(requiredPasses) || requiredPasses < 3) failures.push({ code: "INVALID_REQUIRED_PASS_COUNT", actual: route?.requiredPasses ?? null });

  const receipts = Array.isArray(trials) ? trials : [];
  const qualifying = receipts.filter((item) => item?.value?.countsTowardStability === true
    && item.value.promotable === false
    && new Set(["TRIAL_PASS_PERCEPTIBLE_WIN", "TRIAL_PASS_REFERENCE_PARITY"]).has(item.value.decision)
    && item.value.modelName === modelName);
  for (const item of receipts) {
    if (!/^[a-f0-9]{64}$/u.test(item?.sha256 || "") || !item?.path) failures.push({ code: "INVALID_TRIAL_RECEIPT_BINDING", path: item?.path || null });
    if (item?.value?.modelName !== modelName) failures.push({ code: "MIXED_MODEL_TRIAL", expected: modelName, actual: item?.value?.modelName || null });
  }
  for (const field of ["runId", "scenarioId"]) {
    const duplicates = duplicateValues(qualifying, field);
    if (duplicates.length) failures.push({ code: `DUPLICATE_${field.toUpperCase()}`, evidence: [...new Set(duplicates)] });
  }
  const rawHashes = qualifying.map((item) => item.value?.evidenceHashes?.rawResponse).filter(Boolean);
  const duplicateRaw = rawHashes.filter((value, index) => rawHashes.indexOf(value) !== index);
  if (duplicateRaw.length) failures.push({ code: "DUPLICATE_RAW_RESPONSE", evidence: [...new Set(duplicateRaw)] });
  if (qualifying.length < requiredPasses) failures.push({ code: "INSUFFICIENT_QUALIFYING_TRIALS", actual: qualifying.length, required: requiredPasses });

  if (voice?.version !== 1 || voice?.scope !== "WHOLE_CHAPTER_VOICE" || voice?.accepted !== true || !voice?.acceptedAt || !voice?.evidenceRef?.trim()) failures.push({ code: "VOICE_ACCEPTANCE_MISSING" });
  if (voice?.surface !== surface || voice?.modelName !== modelName) failures.push({ code: "VOICE_ACCEPTANCE_ROUTE_MISMATCH" });
  const voiceTrial = qualifying.find((item) => item.value.runId === voice?.sampleRunId) || null;
  if (!voiceTrial || voiceTrial.sha256 !== voice?.trialReceiptSha256) failures.push({ code: "VOICE_ACCEPTANCE_TRIAL_BINDING_MISMATCH", sampleRunId: voice?.sampleRunId || null });

  const averageCreditsPerOutputChar = qualifying.length
    ? Number((qualifying.reduce((sum, item) => sum + Number(item.value.cost?.creditsPerOutputChar || 0), 0) / qualifying.length).toFixed(6))
    : null;
  const decision = failures.length ? "CALIBRATION_INCOMPLETE" : "ELIGIBLE_FOR_PILOT";
  return {
    status: failures.length ? "error" : "success",
    summary: decision,
    decision,
    promotableToProduction: false,
    surface,
    modelName,
    evidence: { qualifyingTrials: qualifying.map((item) => ({ path: item.path, sha256: item.sha256, runId: item.value.runId, scenarioId: item.value.scenarioId })), voiceAcceptanceSha256: sha256(JSON.stringify(voice)), averageCreditsPerOutputChar },
    proposedRoutePatch: failures.length ? null : { status: "PILOT", sameClassPasses: qualifying.length, humanVoiceAccepted: true, allowedAutonomy: "PILOT", automaticRetry: false, pilotBatchPass: false, promotionEvidence: qualifying.map((item) => ({ kind: "trial", path: item.path, sha256: item.sha256 })) },
    failures,
    next_actions: failures.length ? ["Collect only missing distinct zero-repair trials or correct the named voice/evidence binding; do not edit the registry counter manually."] : ["Review and apply the proposed PILOT patch, then run one bounded 5-10 chapter pilot batch before any PRODUCTION decision."],
    note: "Calibration can only open PILOT. It cannot skip the pilot batch or promote directly to PRODUCTION."
  };
}

function parseArgs(argv) {
  const values = { trials: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--trial") values.trials.push(argv[++index]);
    else if (argv[index]?.startsWith("--") && argv[index + 1] !== undefined) values[argv[index].slice(2)] = argv[++index];
    else throw new Error("usage: --registry <json> --voice <json> --surface <id> --model <id> --trial <json> [--trial <json> ...]");
  }
  for (const key of ["registry", "voice", "surface", "model"]) if (!values[key]) throw new Error("usage: --registry <json> --voice <json> --surface <id> --model <id> --trial <json> [--trial <json> ...]");
  if (!values.trials.length) throw new Error("at least one --trial is required");
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  const readJson = (file) => JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  const trials = args.trials.map((file) => { const text = fs.readFileSync(path.resolve(file), "utf8"); return { path: file, sha256: sha256(text), value: JSON.parse(text) }; });
  const result = evaluateRouteCalibration({ registry: readJson(args.registry), trials, voice: readJson(args.voice), surface: args.surface, modelName: args.model });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.decision !== "ELIGIBLE_FOR_PILOT") process.exitCode = 2;
}
