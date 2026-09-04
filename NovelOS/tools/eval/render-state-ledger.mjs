#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { auditEntityStateLedger } from "./state-ledger-audit.mjs";

const cell = value => String(value ?? "-").replaceAll("|", "\\|").replace(/\r?\n/gu, " ");
const table = (headers, rows) => [
  `| ${headers.join(" | ")} |`,
  `| ${headers.map(() => "---").join(" | ")} |`,
  ...rows.map(row => `| ${row.map(cell).join(" | ")} |`),
  ""
].join("\n");

export function renderStateLedger(ledger) {
  const audit = auditEntityStateLedger(ledger);
  if (audit.decision === "HARD_FAIL") throw new Error(`Cannot render an invalid state ledger: ${audit.failures.map(item => item.code).join(", ")}`);
  const lines = [
    "# 实体状态账本视图",
    "",
    "> 本文件由 `entity-state-ledger.json` 确定性生成，仅供人读；不要直接编辑。",
    "",
    `- Canon 版本：${cell(ledger.canonVersion)}`,
    `- 当前章节：${cell(ledger.chapterOrdinal)}`,
    `- 当前场景：${cell(ledger.currentScene?.locationId)}`,
    `- 在场人物：${cell((ledger.currentScene?.presentCharacterIds || []).join(", "))}`,
    "",
    "## 人物",
    "",
    table(["ID", "姓名", "在场", "地点", "状态"], (ledger.characters || []).map(item => [item.id, item.name, item.presence, item.locationId, item.status])),
    "## 物品",
    "",
    table(["ID", "名称", "持有人", "地点", "状态"], (ledger.items || []).map(item => [item.id, item.name, item.holderId, item.locationId, item.status])),
    "## 金钱",
    "",
    table(["账户", "所有者", "币种", "期初", "当前", "变动数"], (ledger.moneyAccounts || []).map(item => [item.id, item.ownerId, item.currency, item.openingBalance, item.currentBalance, item.changes?.length || 0])),
    "## 伤势",
    "",
    table(["ID", "人物", "状态", "开始章", "最早恢复章", "实际恢复章"], (ledger.healthConditions || []).map(item => [item.id, item.characterId, item.status, item.startChapter, item.recoveryNotBeforeChapter, item.resolvedChapter])),
    "## 伏笔",
    "",
    table(["ID", "状态", "首次", "最近推进", "下次窗口", "解决章"], (ledger.foreshadows || []).map(item => [item.id, item.status, item.firstChapter, item.lastAdvancedChapter, item.nextAdvanceByChapter, item.resolvedChapter])),
    "## 审计提示",
    "",
    ...(audit.warnings.length ? audit.warnings.map(item => `- ${item.code}: ${item.message}`) : ["- 无"]),
    ""
  ];
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const rootIndex = process.argv.indexOf("--root");
  const root = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : process.cwd());
  const inputIndex = process.argv.indexOf("--input");
  const outputIndex = process.argv.indexOf("--output");
  const input = path.resolve(root, inputIndex >= 0 ? process.argv[inputIndex + 1] : "NovelOS/04-canon/entity-state-ledger.json");
  const output = path.resolve(root, outputIndex >= 0 ? process.argv[outputIndex + 1] : "NovelOS/04-canon/entity-state-view.md");
  const rendered = renderStateLedger(JSON.parse(fs.readFileSync(input, "utf8")));
  if (process.argv.includes("--write")) {
    const temp = `${output}.tmp-${process.pid}`;
    fs.writeFileSync(temp, rendered, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temp, output);
    process.stdout.write(`${JSON.stringify({ decision: "WRITTEN", output: path.relative(root, output).replaceAll("\\", "/") })}\n`);
  } else process.stdout.write(rendered);
}
