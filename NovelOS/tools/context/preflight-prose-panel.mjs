#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LIMITS = Object.freeze({ mode: 1200, packet: 1800, priorTail: 800, total: 3500 });
const REQUIRED_CHAMBER_FILES = new Set(["README.md", "chamber-manifest.json", "feelfish.json"]);
const ALLOWED_CLIENT_DIRECTORIES = new Set([".feelfish", ".git", "assets", "chapters", "inspirations", "objects", "outline", "records", "roles", "rules"]);
const EXPECTED_CONTENT_FILES = Object.freeze({
  assets: [],
  chapters: ["DRAFT.md"],
  inspirations: [],
  objects: [],
  outline: [],
  records: ["PACKET.md", "PRIOR-TAIL.md"],
  roles: [],
  rules: ["MODE.md"]
});
const REQUIRED_CONTENT_DIRECTORIES = new Set(["chapters", "records", "rules"]);
const REQUIRED_FIELDS = [
  "本章作用",
  "视角锚点",
  "起点状态",
  "章末状态",
  "压力链",
  "人物发动机",
  "事实与能力边界",
  "必须兑现或推进",
  "不可发生",
  "自由空间",
  "叙述取景与信息顺序",
  "情感波形与关系余波"
];

function canonical(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
}

function chars(value) {
  return [...value].length;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function fieldValue(packet, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = packet.match(new RegExp(`^[ \\t]*-[ \\t]*${escaped}(?:（[^）]*）)?[：:][ \\t]*([^\\r\\n]*)$`, "mu"));
  return match?.[1]?.trim() ?? "";
}

export function preflightProsePanel({ modeText, packetText, priorTailText = "", chamberEntries = null }) {
  const mode = canonical(modeText);
  const packet = canonical(packetText);
  const priorTail = canonical(priorTailText);
  const counts = { mode: chars(mode), packet: chars(packet), priorTail: chars(priorTail) };
  counts.total = counts.mode + counts.packet + counts.priorTail;
  const issues = [];

  for (const [part, limit] of Object.entries(LIMITS)) {
    if (counts[part] > limit) issues.push({ code: "CONTEXT_LIMIT", part, actual: counts[part], limit });
  }
  if (!/^## HARD\s*$/mu.test(packet)) issues.push({ code: "MISSING_SECTION", section: "HARD" });
  if (!/^## OPEN\s*$/mu.test(packet)) issues.push({ code: "MISSING_SECTION", section: "OPEN" });

  for (const field of REQUIRED_FIELDS) {
    const value = fieldValue(packet, field);
    if (!value) issues.push({ code: "MISSING_FIELD", field });
    else if (/(?:待定|待确认|TODO|TBD|UNKNOWN|BLOCKED)/iu.test(value)) issues.push({ code: "UNRESOLVED_FIELD", field, value });
  }

  const controlled = `${mode}\n\n${packet}${priorTail ? `\n\n# 上章必要尾段\n${priorTail}` : ""}`;
  const forbiddenMarkers = [
    ["PROJECT_TREE", /<project_files>|完整项目文件树/iu],
    ["HOST_REMINDER", /<system_reminder>|<session_info>/iu],
    ["AGENT_INSTRUCTIONS", /(?:^|[\\/])AGENTS\.md\b/imu],
    ["SKILL_PATH", /\.feelfish[\\/]skills|SKILL\.md\b/iu],
    ["ABSOLUTE_WINDOWS_PATH", /\b[A-Z]:\\(?:Users|Program Files|Windows|番茄)\\/iu]
  ];
  for (const [code, regex] of forbiddenMarkers) {
    if (regex.test(controlled)) issues.push({ code: "FORBIDDEN_CONTEXT_MARKER", marker: code });
  }
  if (/提示词|系统指令|逐条遵守以上规则/iu.test(packet)) {
    issues.push({ code: "PACKET_CONTAINS_META_INSTRUCTION" });
  }
  if (chamberEntries !== null) {
    if (!Array.isArray(chamberEntries)) throw new Error("chamberEntries must be an array when provided");
    for (const entry of chamberEntries) {
      const name = typeof entry === "string" ? entry : entry?.name;
      const type = typeof entry === "string" ? "file" : entry?.type;
      const allowedFile = type === "file" && REQUIRED_CHAMBER_FILES.has(name);
      const allowedDirectory = type === "directory" && ALLOWED_CLIENT_DIRECTORIES.has(name);
      if (!name || (!allowedFile && !allowedDirectory)) {
        issues.push({ code: "UNEXPECTED_CHAMBER_ENTRY", name: name || "<invalid>", type: type || "unknown" });
      }
      if (allowedDirectory && Object.hasOwn(EXPECTED_CONTENT_FILES, name)) {
        const actual = Array.isArray(entry?.contentFiles) ? [...entry.contentFiles].map(String).sort() : null;
        const expected = [...EXPECTED_CONTENT_FILES[name]].sort();
        if (!actual || JSON.stringify(actual) !== JSON.stringify(expected)) {
          issues.push({ code: "NONEMPTY_PROJECT_CONTENT", name, expected, actual });
        }
      }
    }
    for (const expected of REQUIRED_CHAMBER_FILES) {
      if (!chamberEntries.some((entry) => (typeof entry === "string" ? entry : entry?.name) === expected)) {
        issues.push({ code: "MISSING_CHAMBER_ENTRY", name: expected });
      }
    }
    for (const expected of REQUIRED_CONTENT_DIRECTORIES) {
      if (!chamberEntries.some((entry) => typeof entry !== "string" && entry?.type === "directory" && entry?.name === expected)) {
        issues.push({ code: "MISSING_CHAMBER_ENTRY", name: expected });
      }
    }
  }

  const contextBlocked = issues.some((issue) => ["CONTEXT_LIMIT", "FORBIDDEN_CONTEXT_MARKER", "PACKET_CONTAINS_META_INSTRUCTION", "UNEXPECTED_CHAMBER_ENTRY", "MISSING_CHAMBER_ENTRY", "NONEMPTY_PROJECT_CONTENT"].includes(issue.code));
  const packetBlocked = issues.some((issue) => issue.code === "MISSING_SECTION" || issue.code === "MISSING_FIELD" || issue.code === "UNRESOLVED_FIELD");
  const decision = contextBlocked ? "BLOCK_CONTEXT" : packetBlocked ? "BLOCK_PACKET" : "READY_FOR_AUTHORIZATION";

  return {
    decision,
    readyForAuthorization: decision === "READY_FOR_AUTHORIZATION",
    paidCallAuthorized: false,
    note: "This preflight never authorizes or sends a model request. User confirmation is still required at send time.",
    limits: LIMITS,
    counts,
    hashes: { mode: sha256(mode), packet: sha256(packet), priorTail: sha256(priorTail), controlledContext: sha256(controlled) },
    issues
  };
}

function parseArgs(argv) {
  const values = { json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--json") values.json = true;
    else if (argv[i]?.startsWith("--") && argv[i + 1] !== undefined) values[argv[i].slice(2)] = argv[++i];
    else throw new Error("usage: --mode <file> --packet <file> [--tail <file>] [--chamber <dir>] [--json]");
  }
  if (!values.mode || !values.packet) throw new Error("usage: --mode <file> --packet <file> [--tail <file>] [--chamber <dir>] [--json]");
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  const chamberEntries = args.chamber ? fs.readdirSync(args.chamber, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    type: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "other",
    contentFiles: entry.isDirectory() && Object.hasOwn(EXPECTED_CONTENT_FILES, entry.name)
      ? fs.readdirSync(path.join(args.chamber, entry.name)).sort()
      : []
  })) : null;
  const result = preflightProsePanel({
    modeText: fs.readFileSync(args.mode, "utf8"),
    packetText: fs.readFileSync(args.packet, "utf8"),
    priorTailText: args.tail ? fs.readFileSync(args.tail, "utf8") : "",
    chamberEntries
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.readyForAuthorization) process.exitCode = 2;
}
