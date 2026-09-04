#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HIGH_RISK = /(?:[0-9一二三四五六七八九十百千万两半点]+(?:\.[0-9]+)?\s*(?:公斤|千克|kg|克|吨|米|厘米|毫米|升|毫升|伏|安|瓦|摄氏度|成|%|％)|间隙|扭矩|剂量|服用|拧到底|不用调|接线|校准|安全载荷|额定|限重|承重|配比|致死量|保质期)/iu;

function compilePattern(value, label) {
  if (typeof value !== "string" || !value || value.length > 500) throw new Error(`${label} must be a non-empty regex string no longer than 500 characters`);
  try {
    return new RegExp(value, "iu");
  } catch (error) {
    throw new Error(`${label} is not a valid regex: ${error.message}`);
  }
}

function splitClauses(text) {
  return text.split(/[。！？!?；;\n]+/u).map((item) => item.trim()).filter(Boolean);
}

export function validateFactContract(contract) {
  if (!contract || contract.version !== 1) throw new Error("fact contract version must be 1");
  if (!new Set(["NOT_REQUIRED", "READY", "BLOCKED"]).has(contract.status)) throw new Error("fact contract status must be NOT_REQUIRED, READY or BLOCKED");
  if (!Array.isArray(contract.riskDomains) || !Array.isArray(contract.sources) || !Array.isArray(contract.claims) || !Array.isArray(contract.forbiddenPatterns)) throw new Error("riskDomains, sources, claims and forbiddenPatterns must be arrays");

  const sourceIds = new Set();
  for (const source of contract.sources) {
    if (!source?.id || sourceIds.has(source.id)) throw new Error(`invalid or duplicate source id: ${source?.id}`);
    sourceIds.add(source.id);
  }

  const claimIds = new Set();
  const allowedPatterns = [];
  for (const claim of contract.claims) {
    if (!claim?.id || claimIds.has(claim.id)) throw new Error(`invalid or duplicate claim id: ${claim?.id}`);
    claimIds.add(claim.id);
    if (!new Set(["packet", "canon", "external", "derived", "fiction"]).has(claim.kind)) throw new Error(`invalid claim kind for ${claim.id}`);
    if (!Array.isArray(claim.sourceIds)) throw new Error(`${claim.id}.sourceIds must be an array`);
    for (const sourceId of claim.sourceIds) if (!sourceIds.has(sourceId)) throw new Error(`${claim.id} references missing source ${sourceId}`);
    if (claim.kind === "external" && claim.sourceIds.length === 0) throw new Error(`external claim ${claim.id} requires at least one source`);
    if (claim.kind === "derived" && (!Array.isArray(claim.premiseIds) || !claim.premiseIds.length || typeof claim.derivation !== "string" || !claim.derivation.trim())) throw new Error(`derived claim ${claim.id} requires premiseIds and derivation`);
    if (!Array.isArray(claim.draftPatterns) || !claim.draftPatterns.length) throw new Error(`${claim.id}.draftPatterns must contain at least one pattern`);
    for (const [index, pattern] of claim.draftPatterns.entries()) allowedPatterns.push({ claimId: claim.id, regex: compilePattern(pattern, `${claim.id}.draftPatterns[${index}]`) });
  }
  for (const claim of contract.claims.filter((item) => item.kind === "derived")) {
    for (const premiseId of claim.premiseIds) if (!claimIds.has(premiseId)) throw new Error(`derived claim ${claim.id} references missing premise ${premiseId}`);
  }

  const forbidden = contract.forbiddenPatterns.map((item, index) => {
    if (!item?.id || typeof item.reason !== "string") throw new Error(`forbiddenPatterns[${index}] requires id and reason`);
    return { ...item, regex: compilePattern(item.pattern, `${item.id}.pattern`) };
  });
  return { allowedPatterns, forbidden };
}

export function auditFactContract(text, contract, source = "stdin") {
  const compiled = validateFactContract(contract);
  const failures = [];
  const reviews = [];

  if (contract.status === "BLOCKED") failures.push({ code: "FACT_CONTRACT_BLOCKED", evidence: "required professional facts are unresolved" });
  const forbiddenHits = compiled.forbidden.filter((item) => item.regex.test(text)).map((item) => ({ id: item.id, reason: item.reason }));
  if (forbiddenHits.length) failures.push({ code: "FORBIDDEN_PROFESSIONAL_CLAIM", evidence: forbiddenHits });

  const riskyClauses = splitClauses(text).filter((clause) => HIGH_RISK.test(clause));
  const uncovered = riskyClauses.filter((clause) => !compiled.allowedPatterns.some((item) => item.regex.test(clause)));
  if (contract.status === "NOT_REQUIRED" && riskyClauses.length) {
    failures.push({ code: "FACT_CONTRACT_REQUIRED", evidence: riskyClauses.slice(0, 8) });
  } else if (contract.status === "READY" && uncovered.length) {
    failures.push({ code: "UNAUTHORIZED_HIGH_RISK_CLAIM", evidence: uncovered.slice(0, 8) });
  }

  if (contract.status === "READY" && contract.riskDomains.length === 0) reviews.push({ code: "EMPTY_RISK_DOMAIN", evidence: "READY contract has no declared risk domain" });
  return {
    source,
    draftSha256: crypto.createHash("sha256").update(String(text ?? ""), "utf8").digest("hex"),
    scope: "Deterministic claim-provenance gate. It catches uncontracted numbers/procedures but does not prove that a cited source is true or that prose is natural.",
    metrics: { riskDomains: contract.riskDomains, riskyClauses: riskyClauses.length, uncoveredClauses: uncovered.length, claims: contract.claims.length, sources: contract.sources.length },
    decision: failures.length ? "HARD_FAIL" : reviews.length ? "HUMAN_REVIEW_REQUIRED" : "AUTOMATIC_GATE_PASS_SOURCE_TRUTH_STILL_REQUIRES_REVIEW",
    failures,
    reviews
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith("--") || argv[index + 1] === undefined) throw new Error("usage: --contract <json> --draft <text-or-markdown>");
    result[key.slice(2)] = argv[index + 1];
  }
  if (!result.contract || !result.draft) throw new Error("usage: --contract <json> --draft <text-or-markdown>");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  const contract = JSON.parse(fs.readFileSync(args.contract, "utf8"));
  const draft = fs.readFileSync(args.draft, "utf8");
  process.stdout.write(`${JSON.stringify(auditFactContract(draft, contract, args.draft), null, 2)}\n`);
}
