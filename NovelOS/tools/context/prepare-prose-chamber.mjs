#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function canonical(value) {
  return String(value).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\n*$/, "\n");
}

function safeTarget(root, chamber) {
  const rootPath = path.resolve(root);
  const chamberPath = path.resolve(chamber);
  if (rootPath === chamberPath) throw new Error("prose chamber must not be the NovelOS project root");
  const rootFromChamber = path.relative(chamberPath, rootPath);
  if (!rootFromChamber.startsWith("..") && !path.isAbsolute(rootFromChamber)) {
    throw new Error("prose chamber must not contain the NovelOS project");
  }
  return { rootPath, chamberPath };
}

function writeIfAbsent(file, content) {
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { encoding: "utf8", flag: "wx" });
  return true;
}

const FEELFISH_CHAMBER_REGISTRATION = Object.freeze({
  rules: [{ relativePath: "rules/MODE.md" }],
  chapters: [{ relativePath: "chapters/DRAFT.md", chapterStatus: "content" }],
  roles: [],
  objects: [],
  records: [{ relativePath: "records/PACKET.md" }, { relativePath: "records/PRIOR-TAIL.md" }],
  outline: [],
  inspirations: [],
  assets: []
});

function prosePanelAgent(mode) {
  return canonical(`---
name: NovelOS 独立正文作者
description: 只接收闭合章包并生成一版正文；没有工具或技能。
tools: []
skills: []
---
# 运行边界

输入消息必须已经包含完整 Chapter Packet。不要读取、搜索、创建或修改任何项目文件；不要调用工具；不要生成第二版。只交付章名和正文，交付后立即停止。

${mode}`);
}

function proseModelConfig({ modelId = "feelfish", modelName = "feelfish/qwen3.8-flash", temperature = 0.8 } = {}) {
  const normalizedTemperature = Number(temperature);
  if (!String(modelId).trim() || !String(modelName).trim()) throw new Error("prose chamber model id and name are required");
  if (!Number.isFinite(normalizedTemperature) || normalizedTemperature < 0 || normalizedTemperature > 2) {
    throw new Error("prose chamber temperature must be between 0 and 2");
  }
  return {
    modelId: String(modelId).trim(),
    modelName: String(modelName).trim(),
    enableThinkingMode: false,
    temperature: normalizedTemperature
  };
}

function prosePanelSolution(modelConfig) {
  return `${JSON.stringify({
    version: 1,
    primaryAgentId: "novelos-prose-panel",
    name: "NovelOS 独立正文舱",
    description: "单 Agent、无工具、无 Skill；只把闭合章包写成一版正文。",
    agents: [{
      id: "novelos-prose-panel",
      recommendedModel: modelConfig
    }]
  }, null, 2)}\n`;
}

function prosePanelSelection(modelConfig) {
  return `${JSON.stringify({
    currentSolutionId: "feelfish-custom",
    agentModels: {
      "novelos-prose-panel": modelConfig
    }
  }, null, 2)}\n`;
}

function reconcileFeelFishConfig(file) {
  const current = JSON.parse(fs.readFileSync(file, "utf8"));
  if (current.projectType && current.projectType !== "novel") {
    throw new Error("refusing to repurpose a non-isolated FeelFish config");
  }
  const allowedPaths = {
    rules: new Set(["MODE.md", "rules/MODE.md"]),
    chapters: new Set(["DRAFT.md", "chapters/DRAFT.md"]),
    records: new Set(["PACKET.md", "PRIOR-TAIL.md", "records/PACKET.md", "records/PRIOR-TAIL.md"]),
    roles: new Set(), objects: new Set(), outline: new Set(), inspirations: new Set(), assets: new Set()
  };
  for (const [key, allowed] of Object.entries(allowedPaths)) {
    const entries = current[key] ?? [];
    if (!Array.isArray(entries) || entries.some((entry) => !entry || !allowed.has(String(entry.relativePath || "").replace(/\\/g, "/")))) {
      throw new Error("refusing to repurpose a non-isolated FeelFish config");
    }
  }
  const next = {
    ...current,
    ...FEELFISH_CHAMBER_REGISTRATION,
    projectType: "novel",
    fileMeta: current.fileMeta ?? {},
    fileTreeOrder: current.fileTreeOrder ?? {}
  };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function migrateLegacyLayout(chamberPath) {
  const layout = {
    "MODE.md": "rules/MODE.md",
    "PACKET.md": "records/PACKET.md",
    "PRIOR-TAIL.md": "records/PRIOR-TAIL.md",
    "DRAFT.md": "chapters/DRAFT.md"
  };
  for (const [legacy, relativeTarget] of Object.entries(layout)) {
    const source = path.join(chamberPath, legacy);
    if (!fs.existsSync(source)) continue;
    const target = path.join(chamberPath, relativeTarget);
    if (fs.existsSync(target)) throw new Error(`legacy and registered prose chamber files both exist: ${legacy}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(source, target);
  }
}

export function prepareProseChamber({ root, chamber, packet: packetOverride, modelId, modelName, temperature }) {
  const { rootPath, chamberPath } = safeTarget(root, chamber);
  const modeSource = path.join(rootPath, "NovelOS", "05-chapter", "panel-prose-mode.md");
  const packetSource = path.join(rootPath, "NovelOS", "05-chapter", "panel-chapter-packet.template.md");
  const mode = canonical(fs.readFileSync(modeSource, "utf8"));
  const packet = canonical(fs.readFileSync(packetOverride ? path.resolve(packetOverride) : packetSource, "utf8"));
  const modelConfig = proseModelConfig({ modelId, modelName, temperature });
  fs.mkdirSync(chamberPath, { recursive: true });
  migrateLegacyLayout(chamberPath);

  const created = [];
  const files = {
    "rules/MODE.md": mode,
    "records/PACKET.md": packet,
    "records/PRIOR-TAIL.md": "",
    "chapters/DRAFT.md": "",
    ".feelfish/agents/novelos-prose-panel.md": prosePanelAgent(mode),
    ".feelfish/solutions/feelfish-custom.json": prosePanelSolution(modelConfig),
    ".feelfish/solution.json": prosePanelSelection(modelConfig),
    "feelfish.json": `${JSON.stringify({ ...FEELFISH_CHAMBER_REGISTRATION, projectType: "novel", fileMeta: {}, fileTreeOrder: {} }, null, 2)}\n`,
    "README.md": canonical(`# NovelOS Prose Chamber

这是正文隔离舱，不是资料仓库。请把此目录作为单独的 FeelFish 项目打开。

1. 只在 \`records/PACKET.md\` 填本章闭合章包；可选把上一章必要尾段放入 \`records/PRIOR-TAIL.md\`。
2. 选择“NovelOS 独立正文舱”方案与“NovelOS 独立正文作者”；不要使用内置“专业辅助”。
3. 把闭合 Packet 直接放进单次用户消息；此 Agent 不读取文件、不调用工具、不生成第二版。
4. 每章使用新会话。不要再添加 Agent、Skill、整本小说、研究库或项目树。
5. 发送前从 NovelOS 主项目运行 \`preflight-prose-panel.mjs\`；它通过也不等于已授权付费。
6. 原始回复完整保存到 \`chapters/DRAFT.md\`，再交回主项目做硬检、叙事审计和状态提交。
`)
  };

  for (const [name, content] of Object.entries(files)) {
    if (writeIfAbsent(path.join(chamberPath, name), content)) created.push(name);
  }
  reconcileFeelFishConfig(path.join(chamberPath, "feelfish.json"));

  const modeOnDisk = canonical(fs.readFileSync(path.join(chamberPath, "rules", "MODE.md"), "utf8"));
  const canonicalModeSha256 = sha256(mode);
  const manifest = {
    version: 1,
    isolated: true,
    expectedFiles: Object.keys(files),
    modeChars: [...modeOnDisk].length,
    modeSha256: sha256(modeOnDisk),
    canonicalModeSha256,
    modeMatchesCanonical: sha256(modeOnDisk) === canonicalModeSha256,
    modelConfig,
    warning: "Only the generated tool-free prose agent is allowed. Do not add more agents, skills, project trees, research libraries or full-book history."
  };
  const manifestPath = path.join(chamberPath, "chamber-manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { chamber: chamberPath, created, manifest };
}

export function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith("--") || argv[i + 1] === undefined) throw new Error("usage: --root <NovelOS project> --chamber <isolated directory> [--packet <filled packet>] [--model-id <provider>] [--model-name <model>] [--temperature <number>]");
    const rawName = key.slice(2);
    const field = rawName.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    values[field] = argv[i + 1];
  }
  if (!values.root || !values.chamber) throw new Error("usage: --root <NovelOS project> --chamber <isolated directory> [--packet <filled packet>] [--model-id <provider>] [--model-name <model>] [--temperature <number>]");
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(prepareProseChamber(args), null, 2)}\n`);
}
