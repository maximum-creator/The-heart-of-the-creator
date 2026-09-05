#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function frontmatterList(text, key) {
  const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---/u)?.[1] || "";
  const lines = frontmatter.split(/\r?\n/u);
  const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*(?:\\[\\])?\\s*$`, "u").test(line));
  if (start < 0 || /\[\]\s*$/u.test(lines[start])) return [];
  const values = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s{2}-\s+(.+)$/u);
    if (!match) break;
    values.push(match[1].trim());
  }
  return values;
}

export function checkSystemTopology(root) {
  const projectRoot = path.resolve(root);
  const policy = readJson(path.join(projectRoot, "NovelOS", "00-control", "system-topology-policy.json"));
  const active = readJson(path.join(projectRoot, ".feelfish", "solution.json"));
  const blocklist = readJson(path.join(projectRoot, "NovelOS", "00-control", "model-route-blocklist.json"));
  const registry = readJson(path.join(projectRoot, "NovelOS", "00-control", "production-route-registry.json"));
  const capabilityMapFile = path.join(projectRoot, "NovelOS", "00-control", "capability-model-map.json");
  const capabilityMap = fs.existsSync(capabilityMapFile) ? readJson(capabilityMapFile) : null;
  const failures = [];
  const referencedSkills = new Map();

  if (capabilityMap) {
    const policyIds = Object.keys(policy.agents).sort();
    const mappedIds = Object.keys(capabilityMap.bindings || {}).sort();
    if (JSON.stringify(policyIds) !== JSON.stringify(mappedIds)) failures.push({ code: "CAPABILITY_MODEL_AGENT_SET_MISMATCH", missing: policyIds.filter(id => !mappedIds.includes(id)), unexpected: mappedIds.filter(id => !policyIds.includes(id)) });
  }

  const solutionId = typeof active.currentSolutionId === "string" ? active.currentSolutionId.trim() : "";
  const preferredSolutionFile = solutionId ? path.join(projectRoot, ".feelfish", "solutions", `${solutionId}.json`) : null;
  const legacyCustomFile = path.join(projectRoot, ".feelfish", "solution", "feelfish-custom.json");
  const solutionFile = preferredSolutionFile && fs.existsSync(preferredSolutionFile)
    ? preferredSolutionFile
    : solutionId === "feelfish-custom" && fs.existsSync(legacyCustomFile)
      ? legacyCustomFile
      : null;
  if (!solutionId) {
    failures.push({ code: "MISSING_CURRENT_SOLUTION_ID" });
  } else if (!solutionFile) {
    failures.push({ code: "MISSING_SOLUTION_CONFIG", solutionId });
  } else {
    const solution = readJson(solutionFile);
    const expectedSolutionVersion = Number(policy.feelFishSolution?.schemaVersion ?? 1);
    if (solution.version !== expectedSolutionVersion) failures.push({ code: "UNSUPPORTED_SOLUTION_VERSION", solutionId, expected: expectedSolutionVersion, actual: solution.version ?? null });
    if (!Array.isArray(solution.agents) || solution.agents.length === 0) {
      failures.push({ code: "INVALID_SOLUTION_AGENTS", solutionId });
    } else {
      const ids = solution.agents.map((item) => typeof item?.id === "string" ? item.id.trim() : "");
      const duplicates = [...new Set(ids.filter((id, index) => id && ids.indexOf(id) !== index))];
      if (ids.some((id) => !id)) failures.push({ code: "INVALID_SOLUTION_AGENT_ID", solutionId });
      if (duplicates.length) failures.push({ code: "DUPLICATE_SOLUTION_AGENT_ID", solutionId, agentIds: duplicates });
      if (typeof solution.primaryAgentId !== "string" || !ids.includes(solution.primaryAgentId.trim())) {
        failures.push({ code: "INVALID_SOLUTION_PRIMARY_AGENT", solutionId, actual: solution.primaryAgentId ?? null });
      }
      const expectedIds = Object.keys(policy.agents).sort();
      const actualIds = [...new Set(ids.filter(Boolean))].sort();
      if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
        failures.push({
          code: "SOLUTION_AGENT_SET_MISMATCH",
          solutionId,
          missing: expectedIds.filter((id) => !actualIds.includes(id)),
          unexpected: actualIds.filter((id) => !expectedIds.includes(id))
        });
      }
      const expectedPrimary = policy.feelFishSolution?.primaryAgentId;
      if (typeof expectedPrimary === "string" && solution.primaryAgentId !== expectedPrimary) {
        failures.push({ code: "SOLUTION_PRIMARY_AGENT_MISMATCH", solutionId, expected: expectedPrimary, actual: solution.primaryAgentId ?? null });
      }
    }
  }

  for (const [agentId, expected] of Object.entries(policy.agents)) {
    const agentFile = path.join(projectRoot, ".feelfish", "agents", `${agentId}.md`);
    if (!fs.existsSync(agentFile)) {
      failures.push({ code: "MISSING_AGENT", agentId });
      continue;
    }
    const text = fs.readFileSync(agentFile, "utf8");
    const skills = frontmatterList(text, "skills");
    const tools = frontmatterList(text, "tools");
    const mcpTools = tools.filter((tool) => tool.startsWith("novelos_"));
    const expectedModel = capabilityMap?.bindings?.[agentId]?.model?.modelName || expected.modelName;
    const activeModel = active.agentModels?.[agentId]?.modelName;
    if (!expectedModel) failures.push({ code: "MISSING_MODEL_BINDING", agentId });
    else if (activeModel !== expectedModel) failures.push({ code: "MODEL_POLICY_DRIFT", agentId, expected: expectedModel, actual: activeModel || null });
    if (skills.length > expected.maxStaticSkills) failures.push({ code: "STATIC_SKILL_BLOAT", agentId, actual: skills.length, max: expected.maxStaticSkills, skills });
    for (const skill of skills) {
      const skillFile = path.join(projectRoot, ".feelfish", "skills", skill, "SKILL.md");
      if (!fs.existsSync(skillFile)) failures.push({ code: "MISSING_REFERENCED_SKILL", agentId, skill });
      const owners = referencedSkills.get(skill) || [];
      owners.push(agentId);
      referencedSkills.set(skill, owners);
    }
    for (const tool of mcpTools) if (!expected.allowedMcpTools.includes(tool)) failures.push({ code: "MCP_SCOPE_LEAK", agentId, tool });
    for (const tool of expected.allowedMcpTools) if (!mcpTools.includes(tool)) failures.push({ code: "MISSING_REQUIRED_MCP_TOOL", agentId, tool });
    if (expected.mustBeWildcardQuarantined && !blocklist.routes.some((route) => route.agentId === agentId && route.modelName === "*")) {
      failures.push({ code: "MISSING_WILDCARD_QUARANTINE", agentId });
    }
  }

  const skillsRoot = path.join(projectRoot, ".feelfish", "skills");
  if (fs.existsSync(skillsRoot)) {
    for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && fs.existsSync(path.join(skillsRoot, entry.name, "SKILL.md")) && !referencedSkills.has(entry.name)) {
        failures.push({ code: "UNBOUND_SKILL", skill: entry.name });
      }
    }
  }

  for (const route of registry.routes || []) {
    if (route.status === "PILOT") {
      if (Number(route.sameClassPasses || 0) < Number(route.requiredPasses || 3)) failures.push({ code: "PILOT_WITHOUT_STABILITY", modelName: route.modelName });
      if (route.humanVoiceAccepted !== true) failures.push({ code: "PILOT_WITHOUT_VOICE_ACCEPTANCE", modelName: route.modelName });
      if (route.allowedAutonomy !== "PILOT") failures.push({ code: "PILOT_AUTONOMY_MISMATCH", modelName: route.modelName });
      if (route.automaticRetry !== false) failures.push({ code: "PILOT_AUTO_RETRY_ENABLED", modelName: route.modelName });
    }
    if (route.status === "PRODUCTION") {
      if (Number(route.sameClassPasses || 0) < Number(route.requiredPasses || 3)) failures.push({ code: "PRODUCTION_WITHOUT_STABILITY", modelName: route.modelName });
      if (route.humanVoiceAccepted !== true) failures.push({ code: "PRODUCTION_WITHOUT_VOICE_ACCEPTANCE", modelName: route.modelName });
      if (route.automaticRetry !== false) failures.push({ code: "PRODUCTION_AUTO_RETRY_ENABLED", modelName: route.modelName });
      if (route.allowedAutonomy !== "PRODUCTION") failures.push({ code: "PRODUCTION_AUTONOMY_MISMATCH", modelName: route.modelName });
      if (route.pilotBatchPass !== true) failures.push({ code: "PRODUCTION_WITHOUT_PILOT_BATCH", modelName: route.modelName });
      const evidenceKinds = new Set((route.promotionEvidence || []).map((item) => item.kind));
      if (!evidenceKinds.has("calibration-gate") || !evidenceKinds.has("pilot-batch")) failures.push({ code: "PRODUCTION_PROMOTION_EVIDENCE_MISSING", modelName: route.modelName, evidenceKinds: [...evidenceKinds] });
      for (const kind of ["calibration-gate", "pilot-batch"]) {
        const evidence = (route.promotionEvidence || []).find((item) => item.kind === kind);
        if (evidence && (!String(evidence.path || "").trim() || !/^[a-f0-9]{64}$/u.test(evidence.sha256 || ""))) failures.push({ code: "PRODUCTION_PROMOTION_EVIDENCE_UNBOUND", modelName: route.modelName, kind });
      }
    }
  }

  return {
    decision: failures.length ? "BLOCK" : "PASS",
    solutionConfigPath: solutionFile ? path.relative(projectRoot, solutionFile).replaceAll("\\", "/") : null,
    checkedAgents: Object.keys(policy.agents).length,
    checkedRoutes: (registry.routes || []).length,
    failures
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const index = process.argv.indexOf("--root");
  const root = index >= 0 ? process.argv[index + 1] : process.cwd();
  const result = checkSystemTopology(root);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.decision !== "PASS") process.exitCode = 2;
}
