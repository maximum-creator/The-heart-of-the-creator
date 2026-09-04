import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { runFactAudit } from "./fact-gateway.mjs";
import { buildSurgicalRevisionOrder } from "../eval/build-surgical-revision-order.mjs";
import { evaluateChapterAcceptance } from "../eval/chapter-acceptance-gate.mjs";
import { auditEntityStateLedger } from "../eval/state-ledger-audit.mjs";

const root = path.resolve(process.env.NOVELOS_PROJECT_ROOT || process.cwd());
const blocked = [".git", "node_modules", ".feelfish/memory", "NovelOS_Backups"];

function safePath(relativePath = "") {
  const normalized = String(relativePath).replace(/\\/g, "/").replace(/^\/+/, "");
  const target = path.resolve(root, normalized);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(prefix)) throw new Error("Path escapes project root");
  return target;
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function isBlocked(file) {
  const rel = relative(file);
  return blocked.some((item) => rel === item || rel.startsWith(item + "/"));
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir) || isBlocked(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (isBlocked(full)) continue;
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function text(file, maxChars) {
  const value = fs.readFileSync(file, "utf8");
  return value.length <= maxChars ? value : value.slice(0, maxChars) + "\n...[truncated]";
}

function jsonText(value) {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

const tools = [
  {
    name: "novelos_project_snapshot",
    description: "Return a compact NovelOS project manifest with paths, sizes and timestamps; it does not return file contents.",
    inputSchema: {
      type: "object",
      properties: { maxFiles: { type: "integer", minimum: 10, maximum: 500, default: 120 } },
      additionalProperties: false
    }
  },
  {
    name: "novelos_context_pack",
    description: "Read only explicitly requested project files plus a bounded number of recent chapter files and return a size-limited context pack.",
    inputSchema: {
      type: "object",
      properties: {
        focusFiles: { type: "array", items: { type: "string" }, maxItems: 20 },
        recentChapterCount: { type: "integer", minimum: 0, maximum: 10, default: 3 },
        maxChars: { type: "integer", minimum: 1000, maximum: 80000, default: 24000 }
      },
      additionalProperties: false
    }
  },
  {
    name: "novelos_repetition_scan",
    description: "Deterministically scan recent chapter text for repeated Chinese character sequences across different files. Signals repetition but does not judge prose quality.",
    inputSchema: {
      type: "object",
      properties: {
        sourceFolder: { type: "string", default: "chapters" },
        recentFiles: { type: "integer", minimum: 2, maximum: 20, default: 5 },
        sequenceLength: { type: "integer", minimum: 4, maximum: 12, default: 6 },
        top: { type: "integer", minimum: 5, maximum: 100, default: 30 }
      },
      additionalProperties: false
    }
  },
  {
    name: "novelos_fact_gaps",
    description: "Find unresolved fact markers. With draftFile AND contractFile, run the local fact-contract checker and return a bounded report with input hashes; does not verify source truth or modify files.",
    inputSchema: {
      type: "object",
      properties: {
        maxResults: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        draftFile: { type: "string", description: "Project-relative .md/.txt in chapters, NovelOS/05-chapter or NovelOS/09-evals; requires contractFile." },
        contractFile: { type: "string", description: "Project-relative JSON in NovelOS/05-chapter, 07-research or 09-evals; requires draftFile. Audit mode omits maxResults." }
      },
      additionalProperties: false
    }
  },
  {
    name: "novelos_cost_estimate",
      description: "Return a rough token envelope and billing readiness. It never authorizes spend while verified input, output and cache rates or an actual request receipt are missing.",
    inputSchema: {
      type: "object",
      properties: {
        inputChars: { type: "integer", minimum: 0 },
        outputChars: { type: "integer", minimum: 0 },
        models: { type: "array", items: { type: "string" } },
        taskCount: { type: "integer", minimum: 1, maximum: 1000, default: 1 },
        billingWindow: { type: "string", enum: ["auto", "offPeak", "peak"], default: "auto" },
        maxCredits: { type: "number", minimum: 0 }
      },
      required: ["inputChars", "outputChars"],
      additionalProperties: false
    }
  },
  {
    name: "novelos_state_audit",
    description: "Cross-check the structured Canon ledger for presence, location, possession, knowledge sources, money balance, injury windows and overdue foreshadowing. It never scores prose or changes story state.",
    inputSchema: {
      type: "object",
      properties: {
        ledgerFile: { type: "string", default: "NovelOS/04-canon/entity-state-ledger.json", description: "Project-relative JSON ledger under NovelOS/04-canon." },
        outputFile: { type: "string", description: "Optional new immutable JSON receipt under records or NovelOS/09-evals." }
      },
      additionalProperties: false
    }
  },
  {
    name: "novelos_revision_order",
    description: "Build and persist one evidence-bound LOCAL revision order from a locked blind-review receipt. NONE writes nothing; STRUCTURAL escalates. Never overwrites files or calls a model.",
    inputSchema: {
      type: "object",
      properties: {
        reviewFile: { type: "string", description: "Project-relative blind-review JSON under NovelOS/09-evals." },
        receiptFile: { type: "string", description: "Project-relative locked blind-review receipt JSON under NovelOS/09-evals." },
        candidateFile: { type: "string", description: "Project-relative anonymous candidate .md/.txt under NovelOS/09-evals." },
        candidateLabel: { type: "string", minLength: 1, maxLength: 16 },
        outputFile: { type: "string", description: "New project-relative .json path under NovelOS/09-evals; existing files are never overwritten." },
        preservedFacts: { type: "array", items: { type: "string", minLength: 1, maxLength: 500 }, maxItems: 30 }
      },
      required: ["reviewFile", "receiptFile", "candidateFile", "candidateLabel", "outputFile"],
      additionalProperties: false
    }
  },
  {
    name: "novelos_chapter_acceptance",
    description: "Run the local unified chapter gate from one project-relative input JSON, persist a new immutable receipt, and return only its decision and hash. It never calls a model, retries prose, edits drafts, or commits canon.",
    inputSchema: {
      type: "object",
      properties: {
        inputFile: { type: "string", description: "Existing project-relative JSON under records or NovelOS/09-evals." },
        outputFile: { type: "string", description: "New project-relative JSON receipt under records or NovelOS/09-evals; never overwritten." }
      },
      required: ["inputFile", "outputFile"],
      additionalProperties: false
    }
  }
];

function projectSnapshot(args) {
  const maxFiles = Math.min(Math.max(args.maxFiles || 120, 10), 500);
  const files = walk(root).sort((a, b) => a.localeCompare(b)).slice(0, maxFiles).map((file) => {
    const stat = fs.statSync(file);
    return { path: relative(file), bytes: stat.size, modified: stat.mtime.toISOString() };
  });
  return { projectRoot: root, returnedFiles: files.length, truncated: walk(root).length > files.length, files };
}

function contextPack(args) {
  const maxChars = Math.min(Math.max(args.maxChars || 24000, 1000), 80000);
  const selected = [];
  for (const item of args.focusFiles || []) {
    const file = safePath(item);
    if (fs.existsSync(file) && fs.statSync(file).isFile() && !isBlocked(file)) selected.push(file);
  }
  const count = Math.min(Math.max(args.recentChapterCount ?? 3, 0), 10);
  if (count) {
    const chapterDir = safePath("chapters");
    const chapters = walk(chapterDir).filter((file) => /\.(md|txt)$/i.test(file)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs).slice(0, count);
    selected.push(...chapters);
  }
  const unique = [...new Set(selected)];
  const perFile = Math.max(600, Math.floor(maxChars / Math.max(unique.length, 1)));
  return {
    projectRoot: root,
    maxChars,
    files: unique.map((file) => ({ path: relative(file), content: text(file, perFile) }))
  };
}

function repetitionScan(args) {
  const dir = safePath(args.sourceFolder || "chapters");
  const recentFiles = Math.min(Math.max(args.recentFiles || 5, 2), 20);
  const n = Math.min(Math.max(args.sequenceLength || 6, 4), 12);
  const top = Math.min(Math.max(args.top || 30, 5), 100);
  const files = walk(dir).filter((file) => /\.(md|txt)$/i.test(file)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs).slice(0, recentFiles);
  const occurrences = new Map();
  for (const file of files) {
    const compact = fs.readFileSync(file, "utf8").replace(/[\s\p{P}\p{S}\dA-Za-z]+/gu, "");
    const seen = new Set();
    for (let length = n; length <= Math.min(n + 10, 24); length++) {
      for (let i = 0; i <= compact.length - length; i++) {
        const seq = compact.slice(i, i + length);
        if (/^(.)\1+$/.test(seq) || seen.has(seq)) continue;
        seen.add(seq);
        if (!occurrences.has(seq)) occurrences.set(seq, []);
        occurrences.get(seq).push(relative(file));
      }
    }
  }
  const candidates = [...occurrences.entries()].filter(([, inFiles]) => new Set(inFiles).size > 1).map(([sequence, inFiles]) => ({ sequence, files: [...new Set(inFiles)] })).sort((a, b) => b.sequence.length - a.sequence.length || b.files.length - a.files.length);
  const repeated = [];
  for (const candidate of candidates) {
    if (repeated.some((kept) => kept.sequence.includes(candidate.sequence) && candidate.files.every((file) => kept.files.includes(file)))) continue;
    repeated.push(candidate);
    if (repeated.length >= top) break;
  }
  return { scannedFiles: files.map(relative), sequenceLength: n, repeated, note: "Deterministic lexical signal only; inspect context before revising." };
}

function factGaps(args) {
  const maxResults = Math.min(Math.max(args.maxResults || 50, 1), 200);
  const roots = ["NovelOS/04-canon", "NovelOS/07-research"].map(safePath);
  const result = [];
  for (const base of roots) {
    for (const file of walk(base).filter((item) => /\.(md|txt|json|ya?ml)$/i.test(item))) {
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (/UNKNOWN|TODO|待核实|待确认|证据不足/i.test(line) && result.length < maxResults) result.push({ path: relative(file), line: index + 1, text: line.trim().slice(0, 240) });
      });
      if (result.length >= maxResults) break;
    }
  }
  return { count: result.length, gaps: result };
}

function costEstimate(args) {
  const ratesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "model-rates.json");
  const rates = JSON.parse(fs.readFileSync(ratesPath, "utf8"));
  const inputTokens = Math.ceil((args.inputChars || 0) / 1.8);
  const outputTokens = Math.ceil((args.outputChars || 0) / 1.8);
  const totalTokens = inputTokens + outputTokens;
  const taskCount = Math.min(Math.max(args.taskCount || 1, 1), 1000);
  const billingWindow = args.billingWindow || "auto";
  const nowParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const weekday = nowParts.find((part) => part.type === "weekday")?.value;
  const hour = Number(nowParts.find((part) => part.type === "hour")?.value);
  const autoDeepSeekPeak = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday) &&
    ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));
  const models = args.models?.length ? args.models : Object.keys(rates.models);
  const known = models.filter((name) => rates.models[name]);
  const unknownModels = models.filter((name) => !rates.models[name]);
  const estimates = known.map((name) => {
    const record = typeof rates.models[name] === "number" ? { creditsPerToken: rates.models[name] } : rates.models[name];
    const forcePeak = billingWindow === "peak";
    const autoPeak = billingWindow === "auto" && record.peakRule === "deepseek-weekday-cn" && autoDeepSeekPeak;
    const isPeak = Boolean(record.peakMultiplier && (forcePeak || autoPeak));
    const appliedMultiplier = isPeak ? record.peakMultiplier : 1;
    const blended = Number(record.creditsPerToken);
    const relativeMagnitude = Number.isFinite(blended) ? (blended <= 2 ? "LOW" : blended <= 20 ? "MEDIUM" : "HIGH") : "UNKNOWN";
    return {
      model: name,
      listedBlendedCreditsPerToken: record.creditsPerToken,
      appliedMultiplier,
      relativeMagnitude,
      magnitudeConfidence: "LOW",
      magnitudeUse: "COMPARISON_ONLY_NOT_AUTHORIZATION",
      estimatedCredits: null,
      withinBudget: null,
      reason: "The local blended rate does not separate input, output, cache-hit and reasoning usage, so it cannot produce a defensible estimate."
    };
  });
  return {
    billingStatus: "UNVERIFIED_RATE_COMPONENTS",
    canAuthorizeSpend: false,
    assumption: "The character-to-token conversion is only a rough context envelope, not a billing estimate. FeelFish charges model input and output differently and may also bill cached context, reasoning, retries and auxiliary calls.",
    ratesUpdatedAt: rates.updatedAt,
    billingWindow,
    autoDeepSeekPeak,
    inputTokens,
    outputTokens,
    totalTokens,
    taskCount,
    totalRouteTokens: totalTokens * taskCount,
    maxCredits: args.maxCredits ?? null,
    estimates,
    unknownModels,
    nextAction: "先从 FeelFish 状态栏取得单次请求日志，记录模型、输入/输出/缓存/推理 token 与实际积分；费率分量可复核前保持付费调用关闭。"
  };
}

function stateLedgerInput(relativePath = "NovelOS/04-canon/entity-state-ledger.json") {
  const raw = String(relativePath || "");
  if (path.isAbsolute(raw) || path.win32.isAbsolute(raw) || raw.includes("\0")) throw new Error("State ledger must be a project-relative JSON path");
  const normalized = raw.replace(/\\/g, "/").replace(/^\.\//u, "");
  if (!normalized.startsWith("NovelOS/04-canon/") || path.extname(normalized).toLowerCase() !== ".json" || normalized.split("/").some(part => part.startsWith("."))) throw new Error("State ledger must stay under NovelOS/04-canon and use .json");
  const file = safePath(normalized);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || isBlocked(file)) throw new Error(`State ledger does not exist: ${normalized}`);
  const realRoot = fs.realpathSync(safePath("NovelOS/04-canon"));
  const realFile = fs.realpathSync(file);
  const prefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (!realFile.startsWith(prefix) || isBlocked(realFile)) throw new Error("State ledger escapes NovelOS/04-canon");
  if (fs.statSync(realFile).size > 1000000) throw new Error("State ledger exceeds 1000000 bytes");
  const source = fs.readFileSync(realFile, "utf8");
  try {
    return { normalized: relative(realFile), source, value: JSON.parse(source) };
  } catch (error) {
    throw new Error(`State ledger JSON parse failed: ${error.message}`);
  }
}

function stateAudit(args) {
  const input = stateLedgerInput(args.ledgerFile);
  const report = auditEntityStateLedger(input.value);
  const receipt = {
    kind: "entity_state_audit",
    version: 1,
    createdAt: new Date().toISOString(),
    input: { path: input.normalized, bytes: Buffer.byteLength(input.source, "utf8"), sha256: crypto.createHash("sha256").update(input.source, "utf8").digest("hex") },
    checker: { name: "state-ledger-audit", sha256: crypto.createHash("sha256").update(fs.readFileSync(new URL("../eval/state-ledger-audit.mjs", import.meta.url))).digest("hex") },
    ...report
  };
  if (!args.outputFile) return { ...receipt, output: null };
  const output = acceptancePath(args.outputFile, "State audit output");
  if (fs.existsSync(output.file)) throw new Error(`State audit output already exists: ${output.normalized}`);
  const parent = path.dirname(output.file);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new Error("State audit output parent does not exist");
  const realRoot = fs.realpathSync(root);
  const realParent = fs.realpathSync(parent);
  const prefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (realParent !== realRoot && !realParent.startsWith(prefix)) throw new Error("State audit output escapes project root");
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > 500000) throw new Error("State audit receipt exceeds 500000 bytes");
  fs.writeFileSync(output.file, serialized, { encoding: "utf8", flag: "wx" });
  return { ...receipt, output: { path: output.normalized, sha256: crypto.createHash("sha256").update(serialized, "utf8").digest("hex") } };
}

function relativeEvalPath(relativePath, extensions) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized.startsWith("NovelOS/09-evals/") || normalized.includes("\0")) throw new Error("Revision input/output files must stay under NovelOS/09-evals");
  const extension = path.extname(normalized).toLowerCase();
  if (!extensions.includes(extension)) throw new Error(`Unsupported revision file extension: ${extension || "none"}`);
  const file = safePath(normalized);
  const evalRoot = safePath("NovelOS/09-evals");
  const evalPrefix = evalRoot.endsWith(path.sep) ? evalRoot : evalRoot + path.sep;
  if (!file.startsWith(evalPrefix)) throw new Error("Revision input/output escapes NovelOS/09-evals");
  return { normalized: relative(file), file };
}

function readRevisionInput(relativePath, extensions, maxBytes) {
  const located = relativeEvalPath(relativePath, extensions);
  if (!fs.existsSync(located.file) || !fs.statSync(located.file).isFile()) throw new Error(`Revision input does not exist: ${located.normalized}`);
  const realRoot = fs.realpathSync(safePath("NovelOS/09-evals"));
  const realFile = fs.realpathSync(located.file);
  const prefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (!realFile.startsWith(prefix) || isBlocked(realFile)) throw new Error("Revision input escapes project root");
  if (fs.statSync(realFile).size > maxBytes) throw new Error(`Revision input exceeds ${maxBytes} bytes`);
  return { ...located, text: fs.readFileSync(realFile, "utf8") };
}

function revisionOrder(args) {
  const review = readRevisionInput(args.reviewFile, [".json"], 1000000);
  const receipt = readRevisionInput(args.receiptFile, [".json"], 1000000);
  const candidate = readRevisionInput(args.candidateFile, [".md", ".txt"], 300000);
  let reviewValue;
  let receiptValue;
  try {
    reviewValue = JSON.parse(review.text);
    receiptValue = JSON.parse(receipt.text);
  } catch (error) {
    throw new Error(`Revision JSON parse failed: ${error.message}`);
  }
  const result = buildSurgicalRevisionOrder({
    review: reviewValue,
    receipt: receiptValue,
    candidateLabel: args.candidateLabel,
    candidateText: candidate.text,
    preservedFacts: args.preservedFacts,
  });
  if (result.decision !== "REVISION_ORDER_READY") {
    return { kind: "surgical_revision_order", ...result, output: null };
  }
  const output = relativeEvalPath(args.outputFile, [".json"]);
  if (fs.existsSync(output.file)) throw new Error(`Revision output already exists: ${output.normalized}`);
  const parent = path.dirname(output.file);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new Error("Revision output parent does not exist");
  const realRoot = fs.realpathSync(safePath("NovelOS/09-evals"));
  const realParent = fs.realpathSync(parent);
  const prefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (realParent !== realRoot && !realParent.startsWith(prefix)) throw new Error("Revision output escapes project root");
  const serialized = `${JSON.stringify(result.order, null, 2)}\n`;
  fs.writeFileSync(output.file, serialized, { encoding: "utf8", flag: "wx" });
  return {
    kind: "surgical_revision_order",
    decision: result.decision,
    output: { path: output.normalized, sha256: crypto.createHash("sha256").update(serialized, "utf8").digest("hex") },
  };
}

function acceptancePath(relativePath, label) {
  const raw = String(relativePath || "");
  if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/u.test(raw) || raw.includes("\0")) throw new Error(`${label} must be a project-relative JSON path`);
  const normalized = raw.replace(/\\/g, "/").replace(/^\.\//u, "");
  if (!(normalized.startsWith("records/") || normalized.startsWith("NovelOS/09-evals/")) || path.extname(normalized).toLowerCase() !== ".json") {
    throw new Error(`${label} must stay under records or NovelOS/09-evals and use .json`);
  }
  const file = safePath(normalized);
  if (isBlocked(file)) throw new Error(`${label} is blocked`);
  return { normalized: relative(file), file };
}

function readAcceptanceInput(relativePath) {
  const located = acceptancePath(relativePath, "Acceptance input");
  if (!fs.existsSync(located.file) || !fs.statSync(located.file).isFile()) throw new Error(`Acceptance input does not exist: ${located.normalized}`);
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(located.file);
  const prefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (!realFile.startsWith(prefix) || isBlocked(realFile)) throw new Error("Acceptance input escapes project root");
  if (fs.statSync(realFile).size > 1000000) throw new Error("Acceptance input exceeds 1000000 bytes");
  const source = fs.readFileSync(realFile, "utf8");
  try {
    return { ...located, source, value: JSON.parse(source) };
  } catch (error) {
    throw new Error(`Acceptance input JSON parse failed: ${error.message}`);
  }
}

function chapterAcceptance(args) {
  const input = readAcceptanceInput(args.inputFile);
  const registryFile = safePath("NovelOS/00-control/production-route-registry.json");
  if (!fs.existsSync(registryFile) || !fs.statSync(registryFile).isFile() || isBlocked(registryFile)) throw new Error("Canonical production route registry is missing");
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryFile, "utf8"));
  } catch (error) {
    throw new Error(`Canonical production route registry JSON parse failed: ${error.message}`);
  }
  const result = evaluateChapterAcceptance({ input: input.value, registry, rootDir: root });
  const output = acceptancePath(args.outputFile, "Acceptance output");
  if (fs.existsSync(output.file)) throw new Error(`Acceptance output already exists: ${output.normalized}`);
  const parent = path.dirname(output.file);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new Error("Acceptance output parent does not exist");
  const realRoot = fs.realpathSync(root);
  const realParent = fs.realpathSync(parent);
  const prefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (realParent !== realRoot && !realParent.startsWith(prefix)) throw new Error("Acceptance output escapes project root");
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > 500000) throw new Error("Acceptance receipt exceeds 500000 bytes");
  fs.writeFileSync(output.file, serialized, { encoding: "utf8", flag: "wx" });
  return {
    kind: "chapter_acceptance",
    decision: result.decision,
    status: result.status,
    chapterId: result.chapterId,
    runId: result.runId,
    eligibleForCanonCommit: result.eligibleForCanonCommit,
    failureCodes: [...new Set(result.failures.map((item) => item.code))].slice(0, 30),
    warningCodes: [...new Set(result.warnings.map((item) => item.code))].slice(0, 30),
    output: { path: output.normalized, sha256: crypto.createHash("sha256").update(serialized, "utf8").digest("hex") },
    note: "Local evidence gate only; this tool never sends or retries a paid model call."
  };
}

async function callTool(name, args) {
  if (name === "novelos_project_snapshot") return projectSnapshot(args);
  if (name === "novelos_context_pack") return contextPack(args);
  if (name === "novelos_repetition_scan") return repetitionScan(args);
  if (name === "novelos_fact_gaps") {
    if (Object.hasOwn(args, "draftFile") || Object.hasOwn(args, "contractFile")) return runFactAudit(root, args);
    return factGaps(args);
  }
  if (name === "novelos_cost_estimate") return costEstimate(args);
  if (name === "novelos_state_audit") return stateAudit(args);
  if (name === "novelos_revision_order") return revisionOrder(args);
  if (name === "novelos_chapter_acceptance") return chapterAcceptance(args);
  throw new Error(`Unknown tool: ${name}`);
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function fail(id, error) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } }) + "\n");
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.id === undefined) return;
  try {
    if (request.method === "initialize") return reply(request.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "novelos-mcp", version: "0.7.0" } });
    if (request.method === "tools/list") return reply(request.id, { tools });
    if (request.method === "tools/call") {
      const value = await callTool(request.params?.name, request.params?.arguments || {});
      return reply(request.id, { content: jsonText(value), isError: false });
    }
    return fail(request.id, new Error(`Unsupported method: ${request.method}`));
  } catch (error) {
    return reply(request.id, { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true });
  }
});
