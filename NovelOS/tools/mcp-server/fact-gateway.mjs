import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { auditFactContract } from '../eval/fact-contract-audit.mjs';

const MAX_FILE_BYTES = 256 * 1024;
const TIMEOUT_MS = 2000;
let activeAudits = 0;

function permitted(relative, kind) {
  const prefixes = kind === 'draft'
    ? ['chapters/', 'NovelOS/05-chapter/', 'NovelOS/09-evals/']
    : ['NovelOS/05-chapter/', 'NovelOS/09-evals/', 'NovelOS/07-research/'];
  return prefixes.some(prefix => relative.startsWith(prefix)) &&
    (kind === 'draft' ? /\.(md|txt)$/i : /\.json$/i).test(relative) &&
    !relative.split('/').some(part => part.startsWith('.'));
}

function readInput(root, requested, kind) {
  if (typeof requested !== 'string' || !requested.trim() || requested.length > 500 ||
      path.isAbsolute(requested) || path.win32.isAbsolute(requested) || /[:\0]/.test(requested)) {
    throw new Error(`${kind} must be a project-relative file path`);
  }
  const normalized = requested.replace(/\\/g, '/');
  if (!permitted(normalized, kind)) throw new Error(`${kind} path is outside the permitted chapter/research folders`);
  const real = fs.realpathSync(path.resolve(root, normalized));
  const realRelative = path.relative(root, real).replace(/\\/g, '/');
  if (!permitted(realRelative, kind)) throw new Error(`${kind} path escapes permitted project folders`);
  const descriptor = fs.openSync(real, 'r');
  let bytes;
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error(`${kind} must be a regular file no larger than ${MAX_FILE_BYTES} bytes`);
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(descriptor, buffer, length, buffer.length - length, length);
      if (!count) break;
      length += count;
    }
    if (length > MAX_FILE_BYTES) throw new Error(`${kind} grew beyond the input size limit`);
    bytes = buffer.subarray(0, length);
  } finally {
    fs.closeSync(descriptor);
  }
  return {
    text: bytes.toString('utf8').replace(/^\uFEFF/, ''),
    receipt: { path: normalized, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
  };
}

function boundedEvidence(value) {
  if (typeof value === 'string') return value.length > 500 ? value.slice(0, 500) + '…[evidence truncated; inspect source]' : value;
  if (Array.isArray(value)) return value.map(boundedEvidence);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, boundedEvidence(item)]));
  return value;
}

function executeIsolated(data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: data, resourceLimits: { maxOldGenerationSizeMb: 48 } });
    let settled = false;
    const finish = (error, report) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(report);
    };
    const timer = setTimeout(() => finish(new Error(`Fact audit timeout after ${TIMEOUT_MS}ms; simplify contract patterns, do not retry unchanged inputs`)), TIMEOUT_MS);
    worker.once('message', message => finish(message.error ? new Error(message.error) : null, message.report));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!settled) finish(new Error(`Fact audit worker exited without a result (${code})`)); });
  });
}

export async function runFactAudit(projectRoot, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some(key => !['draftFile', 'contractFile'].includes(key)) ||
      !args.draftFile || !args.contractFile) {
    throw new Error('Fact audit requires draftFile and contractFile together, without scan-only or extra arguments');
  }
  if (activeAudits >= 2) throw new Error('Fact audit busy; wait for the current audit, do not start duplicate work');
  const root = fs.realpathSync(path.resolve(projectRoot));
  const draft = readInput(root, args.draftFile, 'draft');
  const contractFile = readInput(root, args.contractFile, 'contract');
  const contract = JSON.parse(contractFile.text);
  activeAudits++;
  try {
    const report = boundedEvidence(await executeIsolated({ text: draft.text, contract, source: draft.receipt.path }));
    if (JSON.stringify(report).length > 16000) throw new Error('Fact audit report exceeds the 16000-character limit; narrow the contract before retrying');
    return {
      kind: 'fact_contract_audit',
      status: report.failures.length || report.reviews.length ? 'warning' : 'success',
      summary: report.decision,
      inputs: { draft: draft.receipt, contract: contractFile.receipt },
      checker: { name: 'fact-contract-audit', sha256: createHash('sha256').update(fs.readFileSync(new URL('../eval/fact-contract-audit.mjs', import.meta.url))).digest('hex') },
      report,
      next_actions: ['Save this tool receipt as a candidate report; verify input hashes before reuse. Source truth and narrative quality still require review.'],
      artifacts: [],
    };
  } finally {
    activeAudits--;
  }
}

if (!isMainThread) {
  try {
    parentPort.postMessage({ report: auditFactContract(workerData.text, workerData.contract, workerData.source) });
  } catch (error) {
    parentPort.postMessage({ error: String(error.message).slice(0, 1000) });
  }
}
