#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read valid JSON from ${file}: ${error.message}`);
  }
}

function runtimeRecoverySteps({ solutionId, primaryAgentId, selectPrimary = false }) {
  return [
    ...(selectPrimary ? [{ action: "SELECT_PRIMARY_AGENT", agentId: primaryAgentId || null }] : []),
    { action: "CREATE_NEW_SESSION", shortcut: "Ctrl+N" },
    { action: "VERIFY_ZERO_MESSAGE_BINDING", solutionId, primaryAgentId: primaryAgentId || null }
  ];
}

function inspectRuntimeBinding({ root, activePath, recommendedPath, recommended, active, mismatches }) {
  const sessionsDir = path.join(root, ".feelfish", "memory", "sessions");
  const currentPath = path.join(sessionsDir, "current.json");
  const configuredAt = Math.max(fs.statSync(activePath).mtimeMs, fs.statSync(recommendedPath).mtimeMs);
  if (!fs.existsSync(currentPath)) {
    return { status: "NOT_OBSERVED", configuredAt, reason: "FeelFish has not persisted a current project session" };
  }

  const current = readJson(currentPath);
  const sessionId = String(current.currentSessionId || "");
  if (!/^session-[A-Za-z0-9._-]+$/u.test(sessionId)) {
    mismatches.push({
      agentId: recommended.primaryAgentId || null,
      code: "INVALID_RUNTIME_SESSION_ID",
      severity: "BLOCK",
      expected: "a bounded FeelFish session id",
      actual: sessionId || null,
      evidence: ".feelfish/memory/sessions/current.json"
    });
    return { status: "INVALID", configuredAt, sessionId: sessionId || null };
  }

  const sessionPath = path.join(sessionsDir, `${sessionId}.json`);
  if (!fs.existsSync(sessionPath)) {
    mismatches.push({
      agentId: recommended.primaryAgentId || null,
      code: "MISSING_RUNTIME_SESSION",
      severity: "BLOCK",
      expected: `${sessionId}.json`,
      actual: null,
      evidence: ".feelfish/memory/sessions/current.json points to a missing session"
    });
    return { status: "MISSING", configuredAt, sessionId };
  }

  const session = readJson(sessionPath);
  const createdAt = Number(session.createdAt);
  const base = {
    sessionId,
    sessionPath: path.relative(root, sessionPath).replaceAll("\\", "/"),
    configuredAt,
    createdAt: Number.isFinite(createdAt) ? createdAt : null,
    solutionId: session.solutionId || null,
    primaryAgentId: session.primaryAgentId || null,
    selectedAgentId: session.selectedAgentId || null
  };
  if (!Number.isFinite(createdAt) || createdAt < configuredAt) {
    mismatches.push({
      agentId: recommended.primaryAgentId || null,
      code: "STALE_RUNTIME_SESSION",
      severity: "BLOCK",
      expected: `session created at or after ${Math.ceil(configuredAt)}`,
      actual: Number.isFinite(createdAt) ? createdAt : null,
      evidence: `${base.sessionPath} predates the active solution configuration`
    });
    return {
      status: "STALE_SESSION",
      ...base,
      recoverySteps: runtimeRecoverySteps({
        solutionId: active.currentSolutionId,
        primaryAgentId: recommended.primaryAgentId
      })
    };
  }

  if (session.solutionId !== active.currentSolutionId || session.primaryAgentId !== recommended.primaryAgentId) {
    mismatches.push({
      agentId: session.primaryAgentId || null,
      code: "RUNTIME_PRIMARY_AGENT_MISMATCH",
      severity: "BLOCK",
      expected: { solutionId: active.currentSolutionId, primaryAgentId: recommended.primaryAgentId || null },
      actual: { solutionId: session.solutionId || null, primaryAgentId: session.primaryAgentId || null },
      evidence: `${base.sessionPath} is the latest persisted FeelFish runtime session`
    });
    return {
      status: "PRIMARY_AGENT_MISMATCH",
      ...base,
      recoverySteps: runtimeRecoverySteps({
        solutionId: active.currentSolutionId,
        primaryAgentId: recommended.primaryAgentId,
        selectPrimary: true
      })
    };
  }

  return { status: "BOUND", ...base };
}

export function checkAgentOverrides({ projectRoot }) {
  const root = fs.realpathSync(path.resolve(projectRoot));
  const activePath = path.join(root, ".feelfish", "solution.json");
  const active = readJson(activePath);
  if (typeof active.currentSolutionId !== "string" || !active.currentSolutionId) {
    throw new Error("active .feelfish/solution.json has no currentSolutionId");
  }

  const recommendedPath = path.join(root, ".feelfish", "solutions", `${active.currentSolutionId}.json`);
  const recommended = readJson(recommendedPath);
  const recommendations = new Map((recommended.agents || []).map((item) => [item.id, item.recommendedModel || {}]));
  const blocklistPath = path.join(root, "NovelOS", "00-control", "model-route-blocklist.json");
  const blockedRoutes = fs.existsSync(blocklistPath) ? (readJson(blocklistPath).routes || []) : [];
  const mismatches = [];

  for (const [agentId, override] of Object.entries(active.agentModels || {})) {
    const expected = recommendations.get(agentId);
    if (!expected) continue;

    if (expected.enableThinkingMode === false && override.enableThinkingMode === true) {
      mismatches.push({
        agentId,
        code: "THINKING_REENABLED",
        severity: "BLOCK",
        expected: false,
        actual: true,
        evidence: ".feelfish/solution.json overrides the selected solution recommendation"
      });
    }

    if (typeof expected.modelName === "string" && typeof override.modelName === "string" && expected.modelName !== override.modelName) {
      mismatches.push({
        agentId,
        code: "MODEL_DRIFT",
        severity: "REVIEW",
        expected: expected.modelName,
        actual: override.modelName,
        evidence: ".feelfish/solution.json selects a different model than the active solution"
      });
    }

    if (typeof expected.temperature === "number" && override.temperature !== expected.temperature) {
      mismatches.push({
        agentId,
        code: "TEMPERATURE_DRIFT",
        severity: "BLOCK",
        expected: expected.temperature,
        actual: override.temperature ?? null,
        evidence: ".feelfish/solution.json does not pin the selected solution temperature"
      });
    }

    const blocked = blockedRoutes.find((route) => route.agentId === agentId && route.modelName === override.modelName)
      || blockedRoutes.find((route) => route.agentId === agentId && route.modelName === "*");
    if (blocked) {
      mismatches.push({
        agentId,
        code: "QUARANTINED_ROUTE",
        severity: "BLOCK",
        expected: "a route with an approved low-cost quality sample",
        actual: override.modelName,
        evidence: blocked.reason || "route is listed in NovelOS/00-control/model-route-blocklist.json"
      });
    }
  }

  const runtimeBinding = inspectRuntimeBinding({ root, activePath, recommendedPath, recommended, active, mismatches });

  const decision = mismatches.some((item) => item.severity === "BLOCK")
    ? "BLOCK_MODEL_CALL"
    : mismatches.length
      ? "REVIEW_REQUIRED"
      : "PASS";

  return {
    projectRoot: root,
    currentSolutionId: active.currentSolutionId,
    activePath: path.relative(root, activePath).replaceAll("\\", "/"),
    recommendedPath: path.relative(root, recommendedPath).replaceAll("\\", "/"),
    blocklistPath: fs.existsSync(blocklistPath) ? path.relative(root, blocklistPath).replaceAll("\\", "/") : null,
    runtimeBinding,
    decision,
    mismatches
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const index = process.argv.indexOf("--root");
  const projectRoot = index >= 0 ? process.argv[index + 1] : process.cwd();
  if (!projectRoot) throw new Error("usage: check-agent-overrides.mjs [--root <project-root>]");
  process.stdout.write(`${JSON.stringify(checkAgentOverrides({ projectRoot }), null, 2)}\n`);
}
