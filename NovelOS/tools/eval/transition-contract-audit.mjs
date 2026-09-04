#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DOMAINS = new Set(["information", "relationship", "resource", "risk", "position", "belief", "commitment"]);
const NON_AGENCY_OWNERS = /^(?:system|系统|巧合|运气|作者|旁白|剧情需要)$/iu;

function stable(value) {
  return JSON.stringify(value);
}

function duplicates(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return true;
    seen.add(item.id);
    return false;
  });
}

function validEvidence(evidence, draftText) {
  const quote = evidence?.quote?.trim();
  return Boolean(evidence?.location?.trim() && quote && [...quote].length <= 80 && draftText.includes(quote));
}

export function auditTransitionContract({ contract, delta, draftText }) {
  const failures = [];
  const warnings = [];
  const required = Array.isArray(contract?.requiredTransitions) ? contract.requiredTransitions : [];
  const actual = Array.isArray(delta?.actualTransitions) ? delta.actualTransitions : [];
  const protectedFacts = Array.isArray(contract?.protectedFacts) ? contract.protectedFacts : [];
  const observedFacts = Array.isArray(delta?.observedFacts) ? delta.observedFacts : [];
  const carryContract = Array.isArray(contract?.carryOut) ? contract.carryOut : [];
  const carryActual = Array.isArray(delta?.carryOut) ? delta.carryOut : [];
  const draftSha256 = crypto.createHash("sha256").update(draftText, "utf8").digest("hex");

  if (!contract?.chapterId || contract.chapterId !== delta?.chapterId) failures.push({ code: "CHAPTER_ID_MISMATCH", expected: contract?.chapterId || null, actual: delta?.chapterId || null });
  if (delta?.sourceDraftSha256 !== draftSha256) failures.push({ code: "DRAFT_HASH_MISMATCH", expected: draftSha256, actual: delta?.sourceDraftSha256 || null });
  if (!required.length) failures.push({ code: "NO_REQUIRED_TRANSITION" });
  if (required.length > 3) failures.push({ code: "OVERPLANNED_TRANSITIONS", count: required.length, max: 3 });
  if (duplicates(required).length || duplicates(actual).length || duplicates(protectedFacts).length || duplicates(carryContract).length) failures.push({ code: "DUPLICATE_OR_MISSING_ID" });

  const actualById = new Map(actual.map((item) => [item.id, item]));
  for (const item of required) {
    if (!DOMAINS.has(item.domain)) failures.push({ code: "INVALID_TRANSITION_DOMAIN", id: item.id, actual: item.domain || null });
    if (!item.targetBoundary?.trim()) failures.push({ code: "MISSING_TARGET_BOUNDARY", id: item.id });
    const found = actualById.get(item.id);
    if (!found) {
      failures.push({ code: "REQUIRED_TRANSITION_MISSING", id: item.id });
      continue;
    }
    if (stable(found.from) !== stable(item.from)) failures.push({ code: "ENTRY_STATE_DRIFT", id: item.id, expected: item.from, actual: found.from });
    if (stable(found.from) === stable(found.to)) failures.push({ code: "NO_STATE_CHANGE", id: item.id });
    if (!validEvidence(found.evidence, draftText)) failures.push({ code: "UNGROUNDED_TRANSITION", id: item.id });
    if (item.agencyRequired === true && (found.causeType !== "character-choice" || !found.causeOwner?.trim() || NON_AGENCY_OWNERS.test(found.causeOwner.trim()))) {
      failures.push({ code: "AGENCY_REQUIREMENT_FAILED", id: item.id, causeType: found.causeType || null, causeOwner: found.causeOwner || null });
    }
  }

  const observedById = new Map(observedFacts.map((item) => [item.id, item]));
  for (const item of protectedFacts) {
    const found = observedById.get(item.id);
    if (!found) failures.push({ code: "PROTECTED_FACT_NOT_OBSERVED", id: item.id });
    else if (stable(found.value) !== stable(item.value)) failures.push({ code: "PROTECTED_FACT_CHANGED", id: item.id, expected: item.value, actual: found.value });
  }

  const carryById = new Map(carryActual.map((item) => [item.id, item]));
  for (const item of carryContract) {
    const found = carryById.get(item.id);
    if (!found) failures.push({ code: "CARRY_OUT_MISSING", id: item.id });
    else if (!Array.isArray(item.allowedStatus) || !item.allowedStatus.includes(found.status)) failures.push({ code: "CARRY_OUT_STATUS_INVALID", id: item.id, actual: found.status || null });
    else if (!validEvidence(found.evidence, draftText)) failures.push({ code: "UNGROUNDED_CARRY_OUT", id: item.id });
  }

  for (const item of actual) if (!required.some((entry) => entry.id === item.id)) warnings.push({ code: "UNPLANNED_TRANSITION_REVIEW", id: item.id });

  return {
    decision: failures.length ? "BLOCK" : "PASS",
    draftSha256,
    counts: { required: required.length, actual: actual.length, protectedFacts: protectedFacts.length, carryOut: carryContract.length },
    failures,
    warnings,
    note: "PASS proves that the proposed state delta matches the bounded chapter transition contract and quotes the exact draft. It does not by itself prove literary quality or authorize publication."
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const value = (name) => args[args.indexOf(name) + 1];
  if (!["--contract", "--delta", "--draft"].every((name) => args.includes(name))) throw new Error("usage: --contract <json> --delta <json> --draft <text>");
  const result = auditTransitionContract({ contract: readJson(value("--contract")), delta: readJson(value("--delta")), draftText: fs.readFileSync(value("--draft"), "utf8") });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.decision !== "PASS") process.exitCode = 2;
}
