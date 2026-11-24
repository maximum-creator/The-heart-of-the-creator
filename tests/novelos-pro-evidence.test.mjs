import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { checkDelivery, lockIssue } from '../NovelOS/tools/pro/workflow.mjs';
import { auditRuntime } from '../NovelOS/tools/pro/runtime-audit.mjs';
import { readCanon, readChapterContext, describeCandidate, saveRaw, stageCandidate, approveCanon } from '../NovelOS/tools/pro/canon.mjs';

const file = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const packet = JSON.parse(fs.readFileSync(file('../pro/scene-packet.example.json'), 'utf8'));
const routes = JSON.parse(fs.readFileSync(file('../pro/model-routes.json'), 'utf8'));
const digest = (s) => crypto.createHash('sha256').update(s).digest('hex');
const json = (v) => JSON.stringify(v, null, 2) + '\n';
const provenance = { scope: 'UPSTREAM_RESPONSE', reference: 'fixture/mock-response.json' };
const role = 'novelos-pro-dramaturg';
const observed = JSON.parse(fs.readFileSync(file('../pro/runtime-observation.example.json'), 'utf8'));

function input(runId, chapter = 1, parentVersion = 'GENESIS') {
  const final = '第' + chapter + '章 Alex 的铺门（上）\n\n她把钥匙搁在鞋盒上，伙计看见了。';
  const changes = [{ key: 'knowledge:伙计.钥匙位置', before: null, after: '钥匙在鞋盒上', quote: '她把钥匙搁在鞋盒上' }];
  return { bookId: 'shoe-stall', runId, chapter, parentVersion, packet, raw: final + '\n[NOVELOS END]', finishReason: 'stop',
    finishEvidence: provenance, final, changes, audit: { decision: 'PASS', parentVersion, finalSha256: digest(final),
      changesSha256: digest(json(changes)), evidenceRef: 'fixture/audit-' + runId + '.json' } };
}
function vault(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-canon-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('Pro accepts naturally spaced chapter titles while preserving the real-stop distinction', () => {
  const { raw } = input('one');
  assert.equal(checkDelivery({ raw, finishReason: 'stop', finishEvidence: provenance }).decision, 'READY_FOR_READING');
  assert.equal(checkDelivery({ raw, finishReason: 'stop' }).decision, 'REVIEW_WITHOUT_STOP_RECEIPT');
  assert.equal(checkDelivery({ raw, finishReason: 'MAX_TOKENS', finishEvidence: provenance }).decision, 'INCOMPLETE_RAW');
  for (const title of ['第一章 门外 有人', 'Chapter 1 — Alex', '第十一章 老街：A、B 两把钥匙', '第一回（上）雨夜']) {
    assert.equal(checkDelivery({ raw: raw.replace(/^.*\n/u, title + '\n'), finishReason: 'STOP', finishEvidence: provenance }).decision, 'READY_FOR_READING');
  }
  assert.equal(checkDelivery({ raw: '她转身走了。\n\n天亮了。\n[NOVELOS END]', finishReason: 'stop', finishEvidence: provenance }).decision, 'BLOCK_DELIVERY');
});

test('offline or host-only reports never prove upstream delivery; drift and truncation are separate', () => {
  assert.equal(auditRuntime({ routes, role, observed }).decision, 'UNVERIFIED_RUNTIME');
  const upstream = { ...observed, scope: 'UPSTREAM_REQUEST_AND_RESPONSE', hiddenPrompt: 'private' };
  assert.equal(auditRuntime({ routes, role, observed: upstream }).decision, 'OBSERVED_VALUES_MATCH');
  assert.ok(!JSON.stringify(auditRuntime({ routes, role, observed: upstream })).includes('private'));
  assert.deepEqual(auditRuntime({ routes, role, observed: { ...upstream, actualModel: 'fallback', effort: 'low', sentSamplingParameters: ['temperature'], maxOutputTokens: 2048 } }).mismatches,
    ['actualModel', 'effort', 'maxOutputTokens', 'sentSamplingParameters']);
  assert.equal(auditRuntime({ routes, role, observed: { ...upstream, finishReason: 'length' } }).truncated, true);
  assert.equal(auditRuntime({ routes, role: 'novelos-pro-director', mode: 'FAST', observed: {} }).expected.effort, 'medium');
  assert.equal(auditRuntime({ routes, role: 'novelos-pro-director', mode: 'DEEP', observed: {} }).expected.effort, 'high');
});

test('truncated raw stays recoverable; a new chapter sees only the approved matching draft and delta', (t) => {
  const root = vault(t);
  const c = input('r1');
  assert.equal(saveRaw(root, { ...c, runId: 'stopped', finishReason: 'length' }).delivery, 'INCOMPLETE_RAW');
  assert.throws(() => stageCandidate(root, { ...c, runId: 'stopped', finishReason: 'length' }), /Incomplete/);
  const { candidateSha256 } = stageCandidate(root, c);
  assert.equal(readCanon(root, c.bookId).chapter, 0);
  const approval = { bookId: c.bookId, runId: c.runId, candidateSha256, authorRef: 'author accepted this hash' };
  assert.throws(() => approveCanon(root, { ...approval, candidateSha256: 'f'.repeat(64) }), /does not match/);
  assert.equal(approveCanon(root, approval).decision, 'CANON_APPROVED');
  assert.equal(approveCanon(root, approval).decision, 'ALREADY_APPROVED');
  const current = readCanon(root, c.bookId);
  assert.equal(current.facts[c.changes[0].key].value, '钥匙在鞋盒上');
  const context = readChapterContext(root, c.bookId, [c.changes[0].key, 'knowledge:客人.钥匙位置']);
  assert.equal(context.facts[c.changes[0].key].sourceDraftSha256, c.audit.finalSha256);
  assert.deepEqual(context.missing, ['knowledge:客人.钥匙位置']);
  assert.equal(readChapterContext(root, c.bookId).previousTail, c.final);
  const next = input('r2', 2, current.version);
  assert.throws(() => describeCandidate(root, next), /outdated previous value/);
  next.changes = [];
  next.audit.changesSha256 = digest(json(next.changes));
  const stagedNext = stageCandidate(root, next);
  assert.equal(readCanon(root, c.bookId).chapter, 1);
  assert.equal(approveCanon(root, { ...approval, runId: 'r2', candidateSha256: stagedNext.candidateSha256 }).chapter, 2);
  assert.throws(() => stageCandidate(root, { ...input('stale', 2, 'GENESIS'), changes: [] }), /Stale/);
});

test('unaudited semantic edits, changed state evidence and missing upstream receipt fail closed', (t) => {
  const root = vault(t);
  const c = input('edit');
  const quote = '伙计看见了';
  const { order } = lockIssue({ prose: c.final, proseSha256: c.audit.finalSha256, kind: 'LOCAL', quote, reason: '局部删去重复，但不得改变谁看见钥匙。' });
  const replacement = '伙计没有看见';
  assert.throws(() => stageCandidate(root, { ...c, edit: { order, replacement }, final: c.final.replace(quote, replacement) }), /Matching continuity audit/);
  assert.throws(() => stageCandidate(root, { ...c, changes: [{ ...c.changes[0], quote: '编造的证据' }] }), /quote is missing/);
  const manual = { ...c, finishEvidence: undefined };
  const staged = stageCandidate(root, manual);
  const approval = { bookId: c.bookId, runId: c.runId, candidateSha256: staged.candidateSha256, authorRef: 'manual inspection' };
  assert.throws(() => approveCanon(root, approval), /manual completeness/);
  assert.equal(approveCanon(root, { ...approval, manualDeliveryReviewed: true }).decision, 'CANON_APPROVED');
});

test('concurrent approvals commit one complete snapshot', async (t) => {
  const root = vault(t);
  const first = input('a'), second = input('b');
  const records = [first, second].map((x) => [x.runId, stageCandidate(root, x).candidateSha256]);
  const tryApprove = ([runId, sha]) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file('../NovelOS/tools/pro/canon.mjs'), 'approve', root, first.bookId, runId, sha, 'author-ref'], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', resolve);
  });
  assert.deepEqual((await Promise.all(records.map(tryApprove))).sort(), [0, 1]);
  assert.equal(readCanon(root, first.bookId).chapter, 1);
});