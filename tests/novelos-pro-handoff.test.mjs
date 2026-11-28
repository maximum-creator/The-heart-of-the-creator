import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { approveCanon, describeCandidate, prepareChapter, readCanon, reviewCandidate, saveDeliveryReceipt, saveRaw,
  stageCandidate, verifyChapterDelivery } from '../NovelOS/tools/pro/canon.mjs';

const sample = JSON.parse(fs.readFileSync(new URL('../pro/canon-candidate.example.json', import.meta.url), 'utf8'));
const { hardFacts, ...brief } = sample.packet;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const key = 'promise:归还钥匙';
const thread = { id: '旧账', status: 'open', dueChapter: 2 };
const quote = '宋枝把钥匙搁在鞋盒上';

test('prepared handoff, captured delivery and author approval bind the same chapter run', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-handoff-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { bookId, raw, final } = sample;
  const args = { bookId, chapter: 1, parentVersion: 'GENESIS', brief, factKeys: [], dueDecisions: [] };
  const prep = prepareChapter(root, args);
  assert.deepEqual(prep.packet.hardFacts, []);
  assert.throws(() => prepareChapter(root, { ...args, brief: sample.packet }), /cannot supply Canon/);
  const build = (ready, runId, changes = []) => ({ bookId, runId, chapter: ready.handoff.chapter,
    parentVersion: ready.handoff.parentVersion, handoff: ready.handoff, packet: ready.packet, raw, final, changes });
  const stampAudit = (candidate) => {
    const proof = describeCandidate(root, candidate);
    candidate.audit = { decision: 'PASS', parentVersion: candidate.parentVersion, finalSha256: proof.finalSha256,
      changesSha256: proof.changesSha256, evidenceSha256: proof.evidenceSha256, rawSha256: proof.rawSha256,
      handoffSha256: proof.handoffSha256, receiptSha256: proof.receiptSha256, evidenceRef: 'offline audit' };
  };
  const receiptFor = (ready, runId, finishReason = 'STOP') => ({
    bookId, runId, chapter: ready.handoff.chapter, parentVersion: ready.handoff.parentVersion,
    handoffSha256: ready.handoffSha256, packetSha256: ready.packetSha256, rawSha256: hash(raw),
    scope: 'UPSTREAM_REQUEST_AND_RESPONSE', requestId: 'offline-' + runId, actualModel: 'gemini-4-carbon',
    effort: 'medium', maxOutputTokens: 12288, finishReason,
  });
  const approval = (candidate, staged) => ({ bookId, runId: candidate.runId,
    candidateSha256: staged.candidateSha256, authorRef: 'offline fixture only' });

  const first = build(prep, 'seed', [{ key, before: null, after: '归还钥匙', quote, thread }]);
  assert.equal(verifyChapterDelivery(root, { ...first, finishReason: 'stop',
    finishEvidence: { scope: 'UPSTREAM_RESPONSE', reference: 'missing.json' } }).decision, 'REVIEW_WITHOUT_STOP_RECEIPT');
  assert.throws(() => describeCandidate(root, { ...first, packet: { ...first.packet, hardFacts } }), /prepared handoff/);
  const receipt = saveDeliveryReceipt(root, receiptFor(prep, 'seed'));
  assert.equal(verifyChapterDelivery(root, first).receiptSha256, receipt.receiptSha256);
  assert.equal(verifyChapterDelivery(root, { ...first, raw: raw + '\n' }).decision, 'BLOCK_RECEIPT_MISMATCH');
  assert.equal(verifyChapterDelivery(root, { ...first, runId: 'other-run' }).decision, 'REVIEW_WITHOUT_STOP_RECEIPT');
  assert.equal(verifyChapterDelivery(root, { ...first, finishReason: 'length' }).decision, 'BLOCK_RECEIPT_MISMATCH');
  assert.throws(() => saveDeliveryReceipt(root, { ...receiptFor(prep, 'seed'), effort: 'high' }), /different evidence/);
  stampAudit(first);
  const staged = stageCandidate(root, first);
  const review = reviewCandidate(root, { bookId, runId: 'seed' });
  assert.equal(review.decision, 'AUTHOR_REVIEW_REQUIRED');
  assert.equal(review.proof.deliveryStatus, 'READY_FOR_READING');
  assert.equal(review.raw, raw);
  assert.equal(review.final, final);
  assert.equal(approveCanon(root, approval(first, staged)).decision, 'CANON_APPROVED');

  const head = readCanon(root, bookId);
  const next = { ...args, chapter: 2, parentVersion: head.version, factKeys: [key] };
  assert.throws(() => prepareChapter(root, next), /Every due story thread/);
  assert.throws(() => prepareChapter(root, { ...next, dueDecisions: [{ key, action: 'AUTHOR_REVIEW', reason: '等待作者' }] }),
    /Author decision/);
  const payoff = prepareChapter(root, { ...next, dueDecisions: [{ key, action: 'PAYOFF', reason: '依卷纲兑现' }] });
  assert.deepEqual(payoff.packet.duePayoffs, ['归还钥匙']);
  assert.throws(() => describeCandidate(root, build(payoff, 'forgot-payoff')), /no resolved state evidence/);
  assert.throws(() => describeCandidate(root, { ...build(payoff, 'legacy'), handoff: undefined }), /requires a prepared chapter/);
  assert.throws(() => prepareChapter(root, { ...next, parentVersion: 'GENESIS' }), /Stale chapter handoff/);

  const deferred = prepareChapter(root, { ...next, dueDecisions: [{ key, action: 'DEFER', dueChapter: 4, reason: '下一段落兑现' }] });
  const truncated = build(deferred, 'truncated');
  saveDeliveryReceipt(root, receiptFor(deferred, 'truncated', 'MAX_TOKENS'));
  assert.equal(verifyChapterDelivery(root, truncated).decision, 'INCOMPLETE_RAW');
  assert.equal(saveRaw(root, { ...truncated, finishReason: 'MAX_TOKENS' }).delivery, 'INCOMPLETE_RAW');
  assert.throws(() => stageCandidate(root, truncated), /Incomplete/);
  const fallback = build(deferred, 'fallback');
  saveDeliveryReceipt(root, { ...receiptFor(deferred, 'fallback'), actualModel: 'gemini-3.8-flash' });
  assert.equal(verifyChapterDelivery(root, fallback).decision, 'BLOCK_MODEL_DRIFT');
  assert.throws(() => stageCandidate(root, fallback), /differs from the Carbon/);

  const second = build(deferred, 'deferred');
  stampAudit(second);
  const pending = stageCandidate(root, second);
  const lateTruncation = build(deferred, 'late-truncation');
  stampAudit(lateTruncation);
  const latePending = stageCandidate(root, lateTruncation);
  saveDeliveryReceipt(root, receiptFor(deferred, 'late-truncation', 'MAX_TOKENS'));
  assert.throws(() => approveCanon(root, { ...approval(lateTruncation, latePending), manualDeliveryReviewed: true }), /Incomplete/);
  assert.throws(() => approveCanon(root, approval(second, pending)), /manual completeness/);
  saveDeliveryReceipt(root, receiptFor(deferred, 'deferred'));
  assert.throws(() => approveCanon(root, approval(second, pending)), /manual completeness/);
  assert.equal(approveCanon(root, { ...approval(second, pending), manualDeliveryReviewed: true }).decision, 'CANON_APPROVED');
  assert.equal(readCanon(root, bookId).facts[key].thread.dueChapter, 4);
  assert.equal(readCanon(root, bookId).facts[key].threadOrigin.chapter, 1);
});
