#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA256 = /^[a-f0-9]{64}$/u;
const EXECUTABLE_STATUSES = new Set(["CANDIDATE", "CHALLENGER", "PILOT", "PRODUCTION"]);
const PRICE_MAX_AGE_MS = 60 * 60 * 1000;
const AUTH_MAX_AGE_MS = 15 * 60 * 1000;

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function time(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function fresh(now, capturedAt, maxAgeMs) {
  const current = time(now);
  const captured = time(capturedAt);
  return current !== null && captured !== null && current >= captured && current - captured <= maxAgeMs;
}

function exactRate(value) {
  const required = [value?.inputCreditsPerToken, value?.outputCreditsPerToken, value?.cacheReadCreditsPerToken];
  if (value?.thinkingEnabled === true) required.push(value?.reasoningCreditsPerToken);
  return value?.billingStatus === "VERIFIED_EXACT_COMPONENTS"
    && value?.currency === "credits"
    && required.every((item) => Number.isFinite(Number(item)) && Number(item) >= 0);
}

export function evaluatePaidRunAuthorization({ registry, preflight, priceEvidence, plannedRun, authorization, now }) {
  const failures = [];
  const route = (registry?.routes || []).find((item) => item.surface === plannedRun?.surface && item.modelName === plannedRun?.modelName) || null;
  const estimatedInputTokens = Number(plannedRun?.estimatedInputTokens);
  const estimatedOutputTokens = Number(plannedRun?.estimatedOutputTokens);
  let estimatedCredits = null;

  if (!route) failures.push({ code: "UNREGISTERED_PAID_ROUTE" });
  else {
    if (!EXECUTABLE_STATUSES.has(route.status) || route.allowedAutonomy === "NONE") failures.push({ code: "ROUTE_NOT_EXECUTABLE", status: route.status || null });
    if (route.automaticRetry !== false) failures.push({ code: "ROUTE_RETRY_NOT_DISABLED" });
  }

  if (!preflight?.path || !SHA256.test(preflight?.sha256 || "") || preflight?.value?.decision !== "READY_FOR_AUTHORIZATION" || preflight?.value?.paidCallAuthorized !== false) failures.push({ code: "PREFLIGHT_BINDING_INVALID" });
  if (!SHA256.test(preflight?.value?.hashes?.controlledContext || "")) failures.push({ code: "PREFLIGHT_CONTEXT_HASH_INVALID" });
  if (Number(plannedRun?.contextChars) !== Number(preflight?.value?.counts?.total)) failures.push({ code: "PLANNED_CONTEXT_SIZE_MISMATCH" });
  if (plannedRun?.contextSha256 !== preflight?.value?.hashes?.controlledContext) failures.push({ code: "PLANNED_CONTEXT_HASH_MISMATCH" });

  if (!priceEvidence?.path || !SHA256.test(priceEvidence?.sha256 || "") || priceEvidence?.value?.modelName !== plannedRun?.modelName || !priceEvidence?.value?.sourceRef?.trim()) failures.push({ code: "PRICE_EVIDENCE_BINDING_INVALID" });
  if (!exactRate(priceEvidence?.value)) failures.push({ code: "PRICE_COMPONENTS_INCOMPLETE" });
  if (!Number.isInteger(estimatedInputTokens) || estimatedInputTokens <= 0 || !Number.isInteger(estimatedOutputTokens) || estimatedOutputTokens <= 0) {
    failures.push({ code: "TOKEN_ESTIMATE_INCOMPLETE" });
  } else if (exactRate(priceEvidence?.value)) {
    estimatedCredits = Math.ceil(
      estimatedInputTokens * Number(priceEvidence.value.inputCreditsPerToken)
      + estimatedOutputTokens * Number(priceEvidence.value.outputCreditsPerToken)
    );
    if (route && estimatedCredits > Number(route.maxCreditsPerRun)) {
      failures.push({
        code: "ESTIMATED_COST_EXCEEDS_ROUTE_BUDGET",
        estimatedCredits,
        routeMax: Number(route.maxCreditsPerRun),
        assumption: "no-cache input plus planned output token envelope"
      });
    }
  }
  if (!fresh(now, priceEvidence?.value?.capturedAt, PRICE_MAX_AGE_MS)) failures.push({ code: "PRICE_EVIDENCE_STALE" });
  if (plannedRun?.thinkingEnabled !== priceEvidence?.value?.thinkingEnabled) failures.push({ code: "THINKING_MODE_PRICE_MISMATCH" });

  if (!plannedRun?.runId || !plannedRun?.scenarioId || !plannedRun?.testId) failures.push({ code: "PLANNED_RUN_IDENTITY_INCOMPLETE" });
  if (plannedRun?.automaticRetry !== false || Number(plannedRun?.retryCount) !== 0) failures.push({ code: "RETRY_NOT_DISABLED" });

  if (authorization?.version !== 1 || authorization?.scope !== "ONE_RUN" || !authorization?.authorizationId?.trim() || !authorization?.evidenceRef?.trim()) failures.push({ code: "ACTION_TIME_AUTHORIZATION_INCOMPLETE" });
  if (authorization?.usageState !== "UNUSED") failures.push({ code: "AUTHORIZATION_ALREADY_USED", usageState: authorization?.usageState || null });
  if (!fresh(now, authorization?.authorizedAt, AUTH_MAX_AGE_MS)) failures.push({ code: "AUTHORIZATION_STALE" });
  if (time(authorization?.authorizedAt) !== null && time(priceEvidence?.value?.capturedAt) !== null && time(authorization.authorizedAt) < time(priceEvidence.value.capturedAt)) failures.push({ code: "AUTHORIZATION_PRECEDES_PRICE_EVIDENCE" });
  if (authorization?.runId !== plannedRun?.runId) failures.push({ code: "AUTHORIZATION_RUN_MISMATCH" });
  if (authorization?.scenarioId !== plannedRun?.scenarioId) failures.push({ code: "AUTHORIZATION_SCENARIO_MISMATCH" });
  if (authorization?.surface !== plannedRun?.surface) failures.push({ code: "AUTHORIZATION_SURFACE_MISMATCH" });
  if (authorization?.modelName !== plannedRun?.modelName) failures.push({ code: "AUTHORIZATION_MODEL_MISMATCH" });
  if (authorization?.contextSha256 !== plannedRun?.contextSha256) failures.push({ code: "AUTHORIZATION_CONTEXT_MISMATCH" });
  if (authorization?.priceEvidenceSha256 !== priceEvidence?.sha256) failures.push({ code: "AUTHORIZATION_PRICE_MISMATCH" });
  const maxCredits = Number(authorization?.maxCredits);
  if (!Number.isFinite(maxCredits) || maxCredits <= 0) failures.push({ code: "AUTHORIZATION_BUDGET_INVALID" });
  else if (route && maxCredits > Number(route.maxCreditsPerRun)) failures.push({ code: "AUTHORIZATION_EXCEEDS_ROUTE_BUDGET", authorized: maxCredits, routeMax: Number(route.maxCreditsPerRun) });
  else if (estimatedCredits !== null && maxCredits < estimatedCredits) failures.push({ code: "AUTHORIZATION_BELOW_ESTIMATED_COST", authorized: maxCredits, estimatedCredits });

  const decision = failures.length ? "BLOCK_PAID_RUN" : "READY_TO_SEND_ONCE";
  const binding = {
    authorizationId: authorization?.authorizationId || null,
    runId: plannedRun?.runId || null,
    scenarioId: plannedRun?.scenarioId || null,
    testId: plannedRun?.testId || null,
    surface: plannedRun?.surface || null,
    modelName: plannedRun?.modelName || null,
    contextSha256: plannedRun?.contextSha256 || null,
    preflightSha256: preflight?.sha256 || null,
    priceEvidenceSha256: priceEvidence?.sha256 || null,
    maxCredits: Number.isFinite(maxCredits) ? maxCredits : null,
    estimatedInputTokens: Number.isInteger(estimatedInputTokens) ? estimatedInputTokens : null,
    estimatedOutputTokens: Number.isInteger(estimatedOutputTokens) ? estimatedOutputTokens : null,
    estimatedCredits,
    authorizedAt: authorization?.authorizedAt || null
  };

  return {
    status: failures.length ? "error" : "success",
    summary: decision,
    decision,
    authorizationReceipt: failures.length ? null : { ...binding, bindingSha256: sha256(JSON.stringify(binding)), consumed: false },
    failures,
    next_actions: failures.length
      ? ["Correct only the named price, context, route or action-time authorization evidence; do not send or switch models automatically."]
      : ["Persist this receipt, send exactly once without changing model/context/thinking/retry settings, then mark the receipt consumed and attach the actual billing detail."],
    note: "This gate never sends a request or authorizes a second attempt. Public price tiers and blended rates are intentionally insufficient."
  };
}

export function parsePaidRunArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error("usage: --registry <json> --preflight <json> --price <json> --run <json> --authorization <json> [--now <iso>]");
    values[argv[index].slice(2)] = argv[index + 1];
  }
  for (const key of ["registry", "preflight", "price", "run", "authorization"]) if (!values[key]) throw new Error("usage: --registry <json> --preflight <json> --price <json> --run <json> --authorization <json> [--now <iso>]");
  return values;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function boundJson(file) {
  const text = fs.readFileSync(path.resolve(file), "utf8");
  return { path: file, sha256: sha256(text), value: JSON.parse(text) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parsePaidRunArgs(process.argv.slice(2));
  const result = evaluatePaidRunAuthorization({
    registry: readJson(args.registry),
    preflight: boundJson(args.preflight),
    priceEvidence: boundJson(args.price),
    plannedRun: readJson(args.run),
    authorization: readJson(args.authorization),
    now: args.now || new Date().toISOString()
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.decision !== "READY_TO_SEND_ONCE") process.exitCode = 2;
}
