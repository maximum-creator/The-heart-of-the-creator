#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function stable(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

export function syncModelRouting(root, { write = false } = {}) {
  const projectRoot = path.resolve(root);
  const mapFile = path.join(projectRoot, "NovelOS", "00-control", "capability-model-map.json");
  const activeFile = path.join(projectRoot, ".feelfish", "solution.json");
  const map = readJson(mapFile);
  const active = readJson(activeFile);
  const solutionId = active.currentSolutionId;
  const solutionFile = path.join(projectRoot, ".feelfish", "solutions", `${solutionId}.json`);
  const solution = readJson(solutionFile);
  const failures = [];
  const bindings = map.bindings || {};
  const solutionAgents = new Map((solution.agents || []).map(item => [item.id, item]));
  for (const [agentId, binding] of Object.entries(bindings)) {
    if (!binding?.capability || !binding?.model?.modelName) failures.push({ code: "INVALID_CAPABILITY_BINDING", agentId });
    const activeModel = active.agentModels?.[agentId];
    const recommended = solutionAgents.get(agentId)?.recommendedModel;
    if (stable(activeModel || {}) !== stable(binding.model || {})) failures.push({ code: "ACTIVE_MODEL_DRIFT", agentId });
    if (stable(recommended || {}) !== stable(binding.model || {})) failures.push({ code: "RECOMMENDED_MODEL_DRIFT", agentId });
  }
  for (const agentId of solutionAgents.keys()) if (!bindings[agentId]) failures.push({ code: "UNMAPPED_SOLUTION_AGENT", agentId });
  if (!write || failures.length === 0) return { decision: failures.length ? "DRIFT" : "PASS", changed: false, failures };

  active.agentModels ||= {};
  for (const [agentId, binding] of Object.entries(bindings)) active.agentModels[agentId] = { ...binding.model };
  solution.agents = solution.agents.map(item => bindings[item.id] ? { ...item, recommendedModel: { ...bindings[item.id].model } } : item);
  const writeAtomic = (file, value) => {
    const backup = `${file}.pre-model-sync.bak`;
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    const temp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temp, file);
  };
  writeAtomic(activeFile, active);
  writeAtomic(solutionFile, solution);
  return { decision: "SYNCED", changed: true, failuresBeforeSync: failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : process.cwd();
  const result = syncModelRouting(root, { write: process.argv.includes("--write") });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.decision === "DRIFT") process.exitCode = 2;
}
