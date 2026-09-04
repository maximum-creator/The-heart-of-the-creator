#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { auditRawProseDelivery } from "./raw-prose-delivery-audit.mjs";
import { analyzeProseCadence } from "./prose-cadence.mjs";
import { analyzeNarrativeFingerprints } from "./narrative-fingerprint.mjs";
import { auditT09 } from "./t09-hard-audit.mjs";

const REQUIRED_RUN_FIELDS = ["runId", "scenarioId", "testId", "surface", "modelName", "inputTokens", "outputTokens", "actualCredits", "retryCount", "automaticRetry", "contextChars", "modeSha256", "packetSha256"];

export function evaluateProseCandidate({ draftText, source = "stdin", recent = [], run, maxCredits, route = null }) {
  const rawDelivery = auditRawProseDelivery(draftText, source);
  const cadence = analyzeProseCadence(draftText, source);
  const fingerprints = analyzeNarrativeFingerprints([{ source, text: draftText }, ...recent]);
  const taskAudit = /^T(?:09|11|12)(?:-|$)/u.test(run?.testId || "") ? auditT09(draftText, source) : null;
  const failures = [...rawDelivery.failures];
  const reviews = [...cadence.signals, ...fingerprints.files[0].signals, ...fingerprints.collectionSignals];
  const missingRunFields = REQUIRED_RUN_FIELDS.filter((field) => run?.[field] === undefined || run?.[field] === null || run?.[field] === "");

  if (missingRunFields.length) failures.push({ code: "INCOMPLETE_RUN_EVIDENCE", evidence: missingRunFields });
  if (run?.automaticRetry === true) failures.push({ code: "AUTOMATIC_RETRY_USED", evidence: run.retryCount });
  if (Number(run?.retryCount || 0) > 0 && run?.retryReason !== "TRANSIENT_UNBILLED_ERROR") {
    failures.push({ code: "CONTENT_OR_UNEXPLAINED_RETRY", evidence: run.retryReason || "missing retry reason" });
  }
  if (!Number.isFinite(Number(maxCredits)) || Number(maxCredits) <= 0) failures.push({ code: "INVALID_COST_ENVELOPE", evidence: maxCredits });
  else if (Number(run?.actualCredits) > Number(maxCredits)) failures.push({ code: "COST_ENVELOPE_EXCEEDED", evidence: { actualCredits: Number(run.actualCredits), maxCredits: Number(maxCredits) } });
  if (run?.billingEvidenceScope && run.billingEvidenceScope !== "FULL_REQUEST") {
    failures.push({ code: "INCOMPLETE_BILLING_EVIDENCE", evidence: run.billingEvidenceScope });
  }
  if (taskAudit?.failures?.length) failures.push(...taskAudit.failures.map((item) => ({ ...item, gate: "TASK_HARD_AUDIT" })));
  if (taskAudit?.reviews?.length) reviews.push(...taskAudit.reviews.map((item) => ({ ...item, gate: "TASK_HARD_AUDIT" })));

  const productionReady = route?.status === "PRODUCTION"
    && Number(route.sameClassPasses || 0) >= Number(route.requiredPasses || 3)
    && route.humanVoiceAccepted === true;
  const decision = failures.length
    ? "REJECT"
    : reviews.length
      ? "INDEPENDENT_EDITOR_REVIEW_REQUIRED"
      : productionReady
        ? "AUTONOMOUS_GATE_PASS"
        : "CALIBRATION_REVIEW_REQUIRED";

  return {
    source,
    draftSha256: crypto.createHash("sha256").update(String(draftText ?? ""), "utf8").digest("hex"),
    decision,
    promotable: false,
    eligibleForAutonomousStateCommit: decision === "AUTONOMOUS_GATE_PASS",
    note: "A single deterministic pass never promotes a route. Calibration requires task hard audits, voice acceptance and three successful same-class runs; a proven PRODUCTION route may then pass ordinary chapters autonomously.",
    runEvidence: { missingFields: missingRunFields, maxCredits: Number(maxCredits) || null },
    failures,
    reviews,
    checks: { rawDelivery, cadence, fingerprints, taskAudit },
    humanReview: [
      "删除核心配角后，局势、资源、时间或后果是否真的改变？",
      "关键推进是否来自人物在有限信息下的选择，而非系统、巧合或情报投喂？",
      "情绪是否有私人原因、策略差异和事后余波，而非身体套话加旁白翻译？",
      "读完后最想追的是哪一个由本章因果自然产生的问题？"
    ]
  };
}

function parseArgs(argv) {
  const values = { recent: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--recent") values.recent.push(argv[++index]);
    else if (argv[index]?.startsWith("--") && argv[index + 1] !== undefined) values[argv[index].slice(2)] = argv[++index];
    else throw new Error("usage: --draft <file> --run <json> --max-credits <number> [--route <json>] [--recent <file> ...]");
  }
  if (!values.draft || !values.run || !values["max-credits"]) throw new Error("usage: --draft <file> --run <json> --max-credits <number> [--route <json>] [--recent <file> ...]");
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  const draftText = fs.readFileSync(args.draft, "utf8");
  const run = JSON.parse(fs.readFileSync(args.run, "utf8"));
  const recent = args.recent.map((file) => ({ source: file, text: fs.readFileSync(file, "utf8") }));
  const route = args.route ? JSON.parse(fs.readFileSync(args.route, "utf8")) : null;
  const result = evaluateProseCandidate({ draftText, source: args.draft, recent, run, maxCredits: Number(args["max-credits"]), route });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.decision === "REJECT") process.exitCode = 2;
}
