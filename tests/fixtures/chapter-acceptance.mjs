import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const draft = "旧匾离店\n\n林彻把钥匙推回柜台，没解释。老曹捏住钥匙，看向已经装上车的木匾。";
const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

function writeJson(root, name, value) {
  fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novelos-acceptance-"));
  const preflight = {
    decision: "READY_FOR_AUTHORIZATION",
    counts: { total: 1806 },
    hashes: { mode: "mode-hash", packet: "packet-hash", controlledContext: "a".repeat(64) }
  };
  const contract = {
    version: 1,
    chapterId: "C001",
    requiredTransitions: [{ id: "r1", domain: "relationship", from: "互不信任", targetBoundary: "形成有限合作", agencyRequired: true }],
    protectedFacts: [{ id: "f1", value: "木匾已装车" }],
    carryOut: [{ id: "q1", allowedStatus: ["OPEN"] }]
  };
  const delta = {
    version: 1,
    chapterId: "C001",
    sourceDraftSha256: sha256(draft),
    actualTransitions: [{ id: "r1", from: "互不信任", to: "有限合作", causeType: "character-choice", causeOwner: "林彻", evidence: { location: "柜台", quote: "林彻把钥匙推回柜台" } }],
    observedFacts: [{ id: "f1", value: "木匾已装车" }],
    carryOut: [{ id: "q1", status: "OPEN", evidence: { location: "章末", quote: "看向已经装上车的木匾" } }]
  };
  writeJson(root, "preflight.json", preflight);
  fs.writeFileSync(path.join(root, "raw.md"), `${draft}\n`, "utf8");
  fs.writeFileSync(path.join(root, "final.md"), draft, "utf8");
  writeJson(root, "fact.json", { version: 1, status: "NOT_REQUIRED", riskDomains: [], sources: [], claims: [], forbiddenPatterns: [] });
  writeJson(root, "transition.json", contract);
  writeJson(root, "delta.json", delta);

  const route = {
    surface: "isolated-prose-chamber", modelName: "feelfish/qwen3.8-max", status: "CANDIDATE",
    sameClassPasses: 0, requiredPasses: 3, humanVoiceAccepted: false, maxCreditsPerRun: 120000,
    automaticRetry: false, allowedAutonomy: "CALIBRATION"
  };
  const authorizationBinding = {
    authorizationId: "AUTH-T11-R1", runId: "T11-R1", scenarioId: "cash-agency-001", testId: "GENERIC-acceptance-binding",
    surface: route.surface, modelName: route.modelName, contextSha256: "a".repeat(64), preflightSha256: sha256(fs.readFileSync(path.join(root, "preflight.json"), "utf8")),
    priceEvidenceSha256: "b".repeat(64), maxCredits: 120000, authorizedAt: "2026-09-04T12:00:00+08:00"
  };
  const authorizationBindingSha256 = sha256(JSON.stringify(authorizationBinding));
  writeJson(root, "paid-authorization.json", { decision: "READY_TO_SEND_ONCE", authorizationReceipt: { ...authorizationBinding, bindingSha256: authorizationBindingSha256, consumed: false }, failures: [] });
  writeJson(root, "length-policy.json", {version:1,metric:"han",min:1,max:200,enforcement:"review",approved:true});
  const input = {
    chapterLengthPolicy: "length-policy.json",
    version: 1,
    chapterId: "C001",
    phase: "CALIBRATION",
    continuityContext: { mode: "STANDALONE_CALIBRATION" },
    route: { surface: route.surface, modelName: route.modelName },
    authorization: { scope: "ONE_RUN", authorizationId: "AUTH-T11-R1", runId: "T11-R1", scenarioId: "cash-agency-001", authorizedAt: "2026-09-04T12:00:00+08:00", modelName: route.modelName, maxCredits: 120000, evidenceRef: "approval-record-1" },
    paidAuthorizationReceipt: "paid-authorization.json",
    preflightReceipt: "preflight.json",
    rawResponse: "raw.md",
    finalDraft: "final.md",
    factContract: "fact.json",
    transitionContract: "transition.json",
    stateDelta: "delta.json",
    recentDrafts: [],
    editorDiff: null,
    rollback: { kind: "git-commit", ref: "1".repeat(40) },
    run: {
      runId: "T11-R1", scenarioId: "cash-agency-001", testId: "GENERIC-acceptance-binding", surface: route.surface, modelName: route.modelName,
      inputTokens: 1800, outputTokens: 1600, actualCredits: 6800, retryCount: 0, automaticRetry: false,
      contextChars: 1806, contextSha256: "a".repeat(64), modeSha256: "mode-hash", packetSha256: "packet-hash", authorizationBindingSha256
    }
  };
  return { root, input, route, registry: { version: 2, routes: [route] } };
}
