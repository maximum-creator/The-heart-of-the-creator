#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { auditFactContract } from "./fact-contract-audit.mjs";
import { auditContinuityInput } from "./continuity-input-audit.mjs";
import { evaluateProseCandidate } from "./prose-candidate-gate.mjs";
import { auditRawProseDelivery } from "./raw-prose-delivery-audit.mjs";
import { auditTransitionContract } from "./transition-contract-audit.mjs";

const PHASES = new Set(["CALIBRATION", "PILOT", "PRODUCTION"]);
const SHA256 = /^[a-f0-9]{64}$/u;

function digest(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function canonicalDraft(text) {
  return String(text ?? "").replace(/^\uFEFF/u, "").replace(/\r\n?/g, "\n").trim();
}

function resolveInside(rootDir, relativePath, label) {
  if (typeof relativePath !== "string" || !relativePath.trim()) throw new Error(`${label} must be a non-empty relative path`);
  if (path.isAbsolute(relativePath)) throw new Error(`${label} must stay inside the run directory`);
  const root = path.resolve(rootDir);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`${label} escapes the run directory`);
  return target;
}

function loadText(rootDir, relativePath, label) {
  const absolutePath = resolveInside(rootDir, relativePath, label);
  return { relativePath, absolutePath, text: fs.readFileSync(absolutePath, "utf8") };
}

function loadJson(rootDir, relativePath, label) {
  const loaded = loadText(rootDir, relativePath, label);
  return { ...loaded, value: JSON.parse(loaded.text) };
}

function artifact(loaded) {
  return { path: loaded.relativePath, sha256: digest(loaded.text), chars: [...loaded.text].length };
}

function validRollback(rollback) {
  return rollback?.kind === "git-commit" && /^[a-f0-9]{40}$/u.test(rollback?.ref || "") && !/^0{40}$/u.test(rollback.ref);
}

export function evaluateChapterAcceptance({ input, registry, rootDir }) {
  const failures = [];
  const warnings = [];
  if (input?.version !== 1) failures.push({ code: "UNSUPPORTED_INPUT_VERSION", actual: input?.version ?? null });
  if (!input?.chapterId?.trim()) failures.push({ code: "MISSING_CHAPTER_ID" });
  if (!PHASES.has(input?.phase)) failures.push({ code: "INVALID_PHASE", actual: input?.phase ?? null });
  const continuity = auditContinuityInput(input);
  failures.push(...continuity.failures);

  const routes = Array.isArray(registry?.routes) ? registry.routes : [];
  const route = routes.find((item) => item.surface === input?.route?.surface && item.modelName === input?.route?.modelName) || null;
  if (!route) failures.push({ code: "UNREGISTERED_ROUTE", route: input?.route || null });
  if (input?.run?.surface !== input?.route?.surface) failures.push({ code: "RUN_SURFACE_MISMATCH", expected: input?.route?.surface || null, actual: input?.run?.surface || null });
  if (input?.run?.modelName !== input?.route?.modelName) failures.push({ code: "RUN_MODEL_MISMATCH", expected: input?.route?.modelName || null, actual: input?.run?.modelName || null });

  const authorization = input?.authorization || {};
  if (authorization.scope !== "ONE_RUN" || !authorization.runId || !authorization.authorizedAt || !authorization.evidenceRef?.trim()) failures.push({ code: "MISSING_ONE_RUN_AUTHORIZATION" });
  if (authorization.runId !== input?.run?.runId) failures.push({ code: "AUTHORIZATION_RUN_MISMATCH", expected: input?.run?.runId || null, actual: authorization.runId || null });
  if (authorization.modelName !== input?.route?.modelName) failures.push({ code: "AUTHORIZATION_MODEL_MISMATCH", expected: input?.route?.modelName || null, actual: authorization.modelName || null });
  if (!Number.isFinite(Number(authorization.maxCredits)) || Number(authorization.maxCredits) <= 0) failures.push({ code: "INVALID_AUTHORIZATION_BUDGET", actual: authorization.maxCredits ?? null });
  if (route && Number(authorization.maxCredits) > Number(route.maxCreditsPerRun)) failures.push({ code: "AUTHORIZATION_EXCEEDS_ROUTE_BUDGET", authorized: Number(authorization.maxCredits), routeMax: Number(route.maxCreditsPerRun) });
  if (route?.automaticRetry !== false) failures.push({ code: "ROUTE_AUTOMATIC_RETRY_NOT_DISABLED" });
  const phaseRouteReady = input?.phase === "CALIBRATION"
    ? route?.allowedAutonomy === "CALIBRATION"
    : input?.phase === "PILOT"
      ? route?.status === "PILOT" && route?.allowedAutonomy === "PILOT" && route?.humanVoiceAccepted === true && Number(route?.sameClassPasses || 0) >= Number(route?.requiredPasses || 3)
      : input?.phase === "PRODUCTION"
        ? route?.status === "PRODUCTION" && route?.allowedAutonomy === "PRODUCTION" && route?.humanVoiceAccepted === true && Number(route?.sameClassPasses || 0) >= Number(route?.requiredPasses || 3)
        : false;
  if (route && !phaseRouteReady) failures.push({ code: "PHASE_ROUTE_MISMATCH", phase: input?.phase || null, routeStatus: route.status || null, allowedAutonomy: route.allowedAutonomy || null });
  if (!validRollback(input?.rollback)) failures.push({ code: "INVALID_ROLLBACK_POINT" });

  let preflight;
  let paidAuthorization;
  let raw;
  let finalDraft;
  let fact;
  let transition;
  let delta;
  let recent = [];
  if (!input?.paidAuthorizationReceipt) failures.push({ code: "PAID_AUTHORIZATION_RECEIPT_REQUIRED" });
  else {
    try {
      paidAuthorization = loadJson(rootDir, input.paidAuthorizationReceipt, "paidAuthorizationReceipt");
    } catch (error) {
      failures.push({ code: "PAID_AUTHORIZATION_RECEIPT_LOAD_FAILED", evidence: error.message });
    }
  }
  try {
    preflight = loadJson(rootDir, input.preflightReceipt, "preflightReceipt");
    raw = loadText(rootDir, input.rawResponse, "rawResponse");
    finalDraft = loadText(rootDir, input.finalDraft, "finalDraft");
    fact = loadJson(rootDir, input.factContract, "factContract");
    transition = loadJson(rootDir, input.transitionContract, "transitionContract");
    delta = loadJson(rootDir, input.stateDelta, "stateDelta");
    recent = (input.recentDrafts || []).map((item, index) => loadText(rootDir, item, `recentDrafts[${index}]`));
  } catch (error) {
    failures.push({ code: "ARTIFACT_LOAD_FAILED", evidence: error.message });
  }

  const checks = {};
  const artifacts = {};
  let lengthPolicy;
  const lengthPolicyPath = input?.chapterLengthPolicy || "NovelOS/00-control/chapter-length-policy.json";
  try {
    const target = resolveInside(rootDir, lengthPolicyPath, "chapterLengthPolicy");
    if (input?.chapterLengthPolicy || fs.existsSync(target)) {
      const loaded = loadJson(rootDir, lengthPolicyPath, "chapterLengthPolicy");
      lengthPolicy = loaded.value;
      artifacts.chapterLengthPolicy = artifact(loaded);
    }
  } catch (error) {
    failures.push({ code: "CHAPTER_LENGTH_POLICY_LOAD_FAILED", evidence: error.message });
  }
  if (preflight && raw && finalDraft && fact && transition && delta) {
    artifacts.preflightReceipt = artifact(preflight);
    if (paidAuthorization) artifacts.paidAuthorizationReceipt = artifact(paidAuthorization);
    artifacts.rawResponse = artifact(raw);
    artifacts.finalDraft = artifact(finalDraft);
    artifacts.factContract = artifact(fact);
    artifacts.transitionContract = artifact(transition);
    artifacts.stateDelta = artifact(delta);
    artifacts.recentDrafts = recent.map(artifact);

    if (preflight.value?.decision !== "READY_FOR_AUTHORIZATION") failures.push({ code: "PREFLIGHT_NOT_READY", actual: preflight.value?.decision || null });
    if (!SHA256.test(preflight.value?.hashes?.controlledContext || "")) failures.push({ code: "INVALID_CONTROLLED_CONTEXT_HASH" });
    if (input.run?.modeSha256 !== preflight.value?.hashes?.mode) failures.push({ code: "MODE_HASH_MISMATCH" });
    if (input.run?.packetSha256 !== preflight.value?.hashes?.packet) failures.push({ code: "PACKET_HASH_MISMATCH" });
    if (Number(input.run?.contextChars) !== Number(preflight.value?.counts?.total)) failures.push({ code: "CONTEXT_CHAR_COUNT_MISMATCH", expected: preflight.value?.counts?.total ?? null, actual: input.run?.contextChars ?? null });

    if (paidAuthorization) {
      const receipt = paidAuthorization.value?.authorizationReceipt || {};
      const binding = {
        authorizationId: receipt.authorizationId || null,
        runId: receipt.runId || null,
        scenarioId: receipt.scenarioId || null,
        testId: receipt.testId || null,
        surface: receipt.surface || null,
        modelName: receipt.modelName || null,
        contextSha256: receipt.contextSha256 || null,
        preflightSha256: receipt.preflightSha256 || null,
        priceEvidenceSha256: receipt.priceEvidenceSha256 || null,
        maxCredits: Number.isFinite(Number(receipt.maxCredits)) ? Number(receipt.maxCredits) : null,
        authorizedAt: receipt.authorizedAt || null
      };
      const bindingSha256 = digest(JSON.stringify(binding));
      if (paidAuthorization.value?.decision !== "READY_TO_SEND_ONCE" || (paidAuthorization.value?.failures || []).length || receipt.consumed !== false
        || receipt.authorizationId !== authorization.authorizationId || receipt.runId !== input.run?.runId || receipt.scenarioId !== input.run?.scenarioId
        || receipt.testId !== input.run?.testId || receipt.surface !== input.route?.surface || receipt.modelName !== input.route?.modelName
        || receipt.contextSha256 !== preflight.value?.hashes?.controlledContext || receipt.preflightSha256 !== artifacts.preflightReceipt.sha256
        || receipt.maxCredits !== Number(authorization.maxCredits) || receipt.authorizedAt !== authorization.authorizedAt || !SHA256.test(receipt.priceEvidenceSha256 || "")) {
        failures.push({ code: "PAID_AUTHORIZATION_RECEIPT_MISMATCH" });
      }
      if (receipt.bindingSha256 !== bindingSha256 || input.run?.authorizationBindingSha256 !== receipt.bindingSha256) failures.push({ code: "PAID_AUTHORIZATION_BINDING_INVALID" });
    }

    checks.rawDelivery = auditRawProseDelivery(raw.text, input.rawResponse);
    if (checks.rawDelivery.decision !== "RAW_DELIVERY_PASS") failures.push({ code: "RAW_DELIVERY_GATE_FAILED", evidence: checks.rawDelivery.failures });

    checks.proseCandidate = evaluateProseCandidate({
      draftText: finalDraft.text,
      source: input.finalDraft,
      recent: recent.map((item) => ({ source: item.relativePath, text: item.text })),
      run: input.run,
      maxCredits: Number(authorization.maxCredits),
      route,
      lengthPolicy
    });
    if (checks.proseCandidate.decision === "REJECT") failures.push({ code: "PROSE_CANDIDATE_REJECTED", evidence: checks.proseCandidate.failures });
    else if (checks.proseCandidate.decision === "INDEPENDENT_EDITOR_REVIEW_REQUIRED") warnings.push({ code: "PROSE_EDITOR_REVIEW_REQUIRED", evidence: checks.proseCandidate.reviews });

    checks.factContract = auditFactContract(finalDraft.text, fact.value, input.finalDraft);
    if (checks.factContract.decision === "HARD_FAIL") failures.push({ code: "FACT_CONTRACT_FAILED", evidence: checks.factContract.failures });
    else if (checks.factContract.decision === "HUMAN_REVIEW_REQUIRED") warnings.push({ code: "FACT_REVIEW_REQUIRED", evidence: checks.factContract.reviews });
    if (fact.value?.status === "READY") {
      if (!input.factSourceReview) failures.push({ code: "FACT_SOURCE_REVIEW_REQUIRED" });
      else {
        try {
          const sourceReview = loadJson(rootDir, input.factSourceReview, "factSourceReview");
          artifacts.factSourceReview = artifact(sourceReview);
          const expectedSourceIds = (fact.value.sources || []).map((item) => item.id).sort();
          const reviewedSourceIds = Array.isArray(sourceReview.value?.reviewedSourceIds) ? [...sourceReview.value.reviewedSourceIds].sort() : [];
          if (sourceReview.value?.decision !== "PASS"
            || sourceReview.value?.contractSha256 !== artifacts.factContract.sha256
            || JSON.stringify(reviewedSourceIds) !== JSON.stringify(expectedSourceIds)) {
            failures.push({ code: "INVALID_FACT_SOURCE_REVIEW_BINDING" });
          }
        } catch (error) {
          failures.push({ code: "FACT_SOURCE_REVIEW_LOAD_FAILED", evidence: error.message });
        }
      }
    }

    checks.transitionContract = auditTransitionContract({ contract: transition.value, delta: delta.value, draftText: finalDraft.text });
    if (checks.transitionContract.decision !== "PASS") failures.push({ code: "TRANSITION_CONTRACT_FAILED", evidence: checks.transitionContract.failures });
    if (checks.transitionContract.warnings.length) warnings.push({ code: "TRANSITION_REVIEW_REQUIRED", evidence: checks.transitionContract.warnings });

    const rawHash = digest(canonicalDraft(raw.text));
    const finalHash = digest(canonicalDraft(finalDraft.text));
    if (rawHash !== finalHash) {
      if (!input.editorDiff) failures.push({ code: "UNRECORDED_EDITOR_CHANGE", rawSha256: rawHash, finalSha256: finalHash });
      else {
        let editorDiff;
        try {
          editorDiff = loadJson(rootDir, input.editorDiff, "editorDiff");
          artifacts.editorDiff = artifact(editorDiff);
          if (editorDiff.value?.fromSha256 !== rawHash || editorDiff.value?.toSha256 !== finalHash || editorDiff.value?.decision !== "PASS" || !Array.isArray(editorDiff.value?.changes) || !editorDiff.value.changes.length) {
            failures.push({ code: "INVALID_EDITOR_DIFF_BINDING" });
          }
        } catch (error) {
          failures.push({ code: "EDITOR_DIFF_LOAD_FAILED", evidence: error.message });
        }
      }
    }
  }

  const autonomous = phaseRouteReady
    && input?.phase === "PRODUCTION"
    && checks.proseCandidate?.decision === "AUTONOMOUS_GATE_PASS";
  let decision;
  if (failures.length) decision = "REJECT";
  else if (warnings.length) decision = "INDEPENDENT_REVIEW_REQUIRED";
  else if (autonomous) decision = "ACCEPT_AUTONOMOUS_STATE_COMMIT";
  else if (input?.phase === "CALIBRATION") decision = "READY_FOR_HUMAN_VOICE_REVIEW";
  else decision = "READY_FOR_BATCH_REVIEW";

  return {
    status: failures.length ? "error" : warnings.length ? "warning" : "success",
    summary: decision,
    decision,
    chapterId: input?.chapterId || null,
    runId: input?.run?.runId || null,
    scenarioId: input?.run?.scenarioId || null,
    eligibleForCanonCommit: decision === "ACCEPT_AUTONOMOUS_STATE_COMMIT",
    continuity: { mode: continuity.mode, chapterOrdinal: continuity.chapterOrdinal, recentDraftCount: continuity.recentDraftCount },
    route: route ? { surface: route.surface, modelName: route.modelName, status: route.status, allowedAutonomy: route.allowedAutonomy } : null,
    cost: { inputTokens: Number(input?.run?.inputTokens) || 0, outputTokens: Number(input?.run?.outputTokens) || 0, actualCredits: Number(input?.run?.actualCredits) || 0 },
    artifacts,
    checks,
    failures,
    warnings,
    next_actions: failures.length
      ? ["Correct only the named evidence or artifact mismatch, then rerun without automatic model retry."]
      : warnings.length
        ? ["Send only the flagged passages and evidence to the independent editor; record a bound diff if the draft changes."]
        : decision === "READY_FOR_HUMAN_VOICE_REVIEW"
          ? ["Collect one whole-chapter voice decision; do not promote the route from a single run."]
          : decision === "READY_FOR_BATCH_REVIEW"
            ? ["Hold the chapter in the pilot batch until the batch acceptance boundary."]
            : ["Commit the state delta and final draft together, retaining this receipt and rollback point."],
    note: "This gate proves evidence binding and configured release eligibility. It does not turn deterministic checks into a claim of literary excellence; calibration and real reader outcomes remain separate evidence."
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error("usage: --input <json> --registry <json> [--root <directory>]");
    values[argv[index].slice(2)] = argv[index + 1];
  }
  if (!values.input || !values.registry) throw new Error("usage: --input <json> --registry <json> [--root <directory>]");
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  const result = evaluateChapterAcceptance({
    input: JSON.parse(fs.readFileSync(inputPath, "utf8")),
    registry: JSON.parse(fs.readFileSync(path.resolve(args.registry), "utf8")),
    rootDir: args.root ? path.resolve(args.root) : path.dirname(inputPath)
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!new Set(["ACCEPT_AUTONOMOUS_STATE_COMMIT", "READY_FOR_HUMAN_VOICE_REVIEW", "READY_FOR_BATCH_REVIEW"]).has(result.decision)) process.exitCode = 2;
}
