#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LEAK_PATTERNS = [
  ["ROLE_DISCLOSURE", /(?:我是|作为)(?:一名)?(?:正文作者|AI|语言模型|写作助手)/u],
  ["PLANNING_LEAK", /(?:让我|我先|下面先)(?:审视|分析|规划|设计|梳理|检查|推演)|(?:场景|人物|因果)(?:分析|规划)[：:]/u],
  ["SELF_REVIEW", /(?:创作说明|写作说明|自评|评分|字数应达标|本章通过|最终检查|以下是正文|以上正文)/u],
  ["RULE_ECHO", /(?:严格遵守|逐条遵守).{0,20}(?:规则|要求|指令)|(?:HARD|OPEN)[：:]/iu],
  ["STRUCTURED_WRAPPER", /^\s*(?:```|\{\s*"|\|\s*(?:检查|项目|维度))/mu]
];

function stripHeading(line) {
  return line.replace(/^\s*#{1,6}\s*/u, "").trim();
}

export function auditRawProseDelivery(text, source = "stdin") {
  const normalized = String(text ?? "").replace(/^\uFEFF/u, "").replace(/\r\n?/g, "\n").trim();
  const lines = normalized.split("\n");
  const firstIndex = lines.findIndex((line) => line.trim());
  const title = firstIndex >= 0 ? stripHeading(lines[firstIndex]) : "";
  const prose = firstIndex >= 0 ? lines.slice(firstIndex + 1).join("\n").trim() : "";
  const failures = [];

  if (!normalized) failures.push({ code: "EMPTY_DELIVERY", evidence: "raw response is empty" });
  if (title && !/^(?:《[^》]{1,30}》|(?:第[\u3400-\u9fff0-9]{1,10}章[ \t]+)?[\u3400-\u9fff0-9：:·]{1,30})$/u.test(title)) {
    failures.push({ code: "INVALID_TITLE_LINE", evidence: title.slice(0, 80) });
  }
  if (!prose) failures.push({ code: "MISSING_PROSE_AFTER_TITLE", evidence: "no prose follows the first non-empty line" });
  for (const [code, regex] of LEAK_PATTERNS) {
    const match = normalized.match(regex);
    if (match) failures.push({ code, evidence: match[0].slice(0, 100) });
  }

  return {
    source,
    draftSha256: crypto.createHash("sha256").update(normalized, "utf8").digest("hex"),
    contract: "The raw model message must be title plus prose only. Extraction or silent cleanup cannot turn a failed delivery into a pass.",
    metrics: { title, proseChars: [...prose].length, totalChars: [...normalized].length },
    decision: failures.length ? "HARD_FAIL" : "RAW_DELIVERY_PASS",
    failures
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const file = process.argv[2];
  const text = file ? fs.readFileSync(file, "utf8") : fs.readFileSync(0, "utf8");
  process.stdout.write(`${JSON.stringify(auditRawProseDelivery(text, file || "stdin"), null, 2)}\n`);
}
