#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function cells(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

export function parseTables(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tables = [];
  let section = "";
  for (let i = 0; i < lines.length; i += 1) {
    if (/^#{1,6}\s+/.test(lines[i])) section = lines[i].replace(/^#{1,6}\s+/, "").trim();
    if (!lines[i].includes("|") || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || "")) continue;
    const headers = cells(lines[i]);
    const rows = [];
    i += 2;
    while (i < lines.length && lines[i].includes("|")) {
      const values = cells(lines[i]);
      if (values.some(Boolean)) rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
      i += 1;
    }
    i -= 1;
    tables.push({ section, headers, rows });
  }
  return tables;
}

export function parseWindow(value) {
  const matches = [...String(value || "").matchAll(/(?:第\s*)?(\d+)\s*(?:章)?/g)].map((match) => Number(match[1]));
  return matches.length ? { min: Math.min(...matches), max: Math.max(...matches) } : null;
}

function isClosed(status) {
  return /回答|完整回收|放弃并闭合|作废并解释|兑现|完成|关闭/.test(status || "");
}

function dueState(window, currentChapter) {
  if (!window || !currentChapter) return "UNSCHEDULED";
  if (currentChapter > window.max) return "OVERDUE";
  if (currentChapter >= window.min) return "DUE_NOW";
  if (window.min - currentChapter <= 3) return "DUE_SOON";
  return "LATER";
}

function readTables(root, relativePath) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) return { file: relativePath, tables: [], missing: true };
  return { file: relativePath, tables: parseTables(fs.readFileSync(file, "utf8")), missing: false };
}

export function auditProject(root, currentChapter = 0) {
  const sources = [
    readTables(root, "NovelOS/02-story/reader-promises.md"),
    readTables(root, "NovelOS/04-canon/foreshadow-ledger.md")
  ];
  const items = [];
  const knownQuestionIds = new Set();

  for (const source of sources) {
    for (const table of source.tables) {
      const isQuestion = /活跃问题/.test(table.section);
      const isForeshadow = /伏笔证据/.test(table.section);
      const isPromise = table.headers.some((header) => /承诺/.test(header));
      for (const row of table.rows) {
        const id = row.ID || row.Id || row.id || "UNKNOWN";
        const status = row.状态 || "";
        if (isQuestion) knownQuestionIds.add(id);
        if (isClosed(status)) continue;
        const windowText = isQuestion ? row.下一推进窗口 : isForeshadow ? row.回收窗口 : row.预计兑现;
        const window = parseWindow(windowText);
        items.push({
          type: isQuestion ? "QUESTION" : isForeshadow ? "FORESHADOW" : isPromise ? "PROMISE" : "OTHER",
          id,
          summary: row[table.headers.find((header) => /读者会问什么|承诺|对应问题/.test(header))] || "",
          status,
          window: windowText || "",
          due: dueState(window, currentChapter),
          source: source.file
        });
      }
    }
  }

  for (const item of items.filter((item) => item.type === "FORESHADOW")) {
    if (item.summary && !knownQuestionIds.has(item.summary)) item.linkWarning = "对应问题ID不存在或未登记";
  }

  const priority = { OVERDUE: 0, DUE_NOW: 1, DUE_SOON: 2, UNSCHEDULED: 3, LATER: 4 };
  items.sort((a, b) => priority[a.due] - priority[b.due] || a.id.localeCompare(b.id, "zh-CN"));
  return {
    root,
    currentChapter: currentChapter || null,
    note: "This is a scheduling and linkage audit, not an instruction to force a payoff into the next chapter.",
    missingFiles: sources.filter((source) => source.missing).map((source) => source.file),
    counts: Object.fromEntries(["OVERDUE", "DUE_NOW", "DUE_SOON", "UNSCHEDULED", "LATER"].map((state) => [state, items.filter((item) => item.due === state).length])),
    items
  };
}

function parseArgs(argv) {
  const result = { root: process.cwd(), chapter: 0, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") result.root = path.resolve(argv[++i]);
    else if (argv[i] === "--chapter") result.chapter = Number(argv[++i]);
    else if (argv[i] === "--json") result.json = true;
  }
  return result;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const report = auditProject(args.root, args.chapter);
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`Story debt audit at chapter ${report.currentChapter ?? "UNKNOWN"}\n`);
    process.stdout.write(`${JSON.stringify(report.counts)}\n`);
    for (const item of report.items.filter((item) => item.due !== "LATER")) process.stdout.write(`${item.due}\t${item.type}\t${item.id}\t${item.summary}\n`);
  }
}
