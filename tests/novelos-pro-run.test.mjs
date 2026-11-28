import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildPro } from '../scripts/build-novelos-pro.mjs';
import {
  approveCanon, readCanon, readReworkHistory, readSavedRaw, saveDeliveryReceipt, selectReworkVersion,
} from '../NovelOS/tools/pro/canon.mjs';
import { rollbackAuthorRework } from '../NovelOS/tools/pro/rework.mjs';

const load = async (name) => JSON.parse(await readFile(new URL('../pro/' + name, import.meta.url), 'utf8'));

test('packaged run resumes the same chapter, locks two reworks and requires the active author selection', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'novelos-local-run-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const project = buildPro(path.join(temporary, 'project'));
  const vault = path.join(temporary, 'vault');
  fs.mkdirSync(vault);
  const script = path.join(project, 'NovelOS/tools/pro/run.mjs');
  const [example, handoff, exampleReview] = await Promise.all([
    load('canon-candidate.example.json'), load('chapter-handoff.example.json'), load('quality-review.example.json'),
  ]);
  const invoke = (command, input) => spawnSync(process.execPath, [script, command, vault, '-'],
    { input: JSON.stringify(input), encoding: 'utf8' });
  const call = (command, input) => {
    const result = invoke(command, input);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const fails = (command, input, pattern) => {
    const result = invoke(command, input);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, pattern);
  };
  const { bookId, runId, raw, changes } = example;
  const base = { bookId, runId, plan: { chapter: 1, parentVersion: 'GENESIS', requiredFactKeys: [], risks: [] },
    brief: handoff.brief, dueDecisions: [] };
  const decision = call('prepare', { ...base, brief: undefined });
  assert.equal(decision.decision, 'BRIEF_REQUIRED');
  const gated = { ...base, runId: 'gated', plan: { ...base.plan, risks: ['creative_difficulty'] } };
  const hold = call('prepare', gated);
  assert.deepEqual(hold.pending, ['novelos-pro-opus']);
  const preDraftRefs = (planSha256) => ({ 'novelos-pro-opus': { planSha256, decision: 'PASS', evidenceRef: 'off-line review' } });
  assert.equal(call('prepare', { ...gated, preDraftRefs: preDraftRefs('0'.repeat(64)) }).decision,
    'PRE_DRAFT_REVIEW_REQUIRED');
  assert.equal(call('prepare', { ...gated, preDraftRefs: preDraftRefs(hold.planSha256) }).decision, 'READY_TO_WRITE');
  const prepared = call('prepare', base);
  assert.equal(prepared.decision, 'READY_TO_WRITE');
  assert.deepEqual(call('prepare', base), { ...prepared, reused: true });
  fails('prepare', { ...base, brief: { ...base.brief, readerPromise: '离线测试的不同章务' } }, /different chapter inputs/);
  const run = { bookId, runId, runSha256: prepared.runSha256 };
  fails('capture', { ...run, runSha256: '0'.repeat(64), raw }, /receipt does not match/);
  fails('draft', { ...run, changes }, /Capture the exact original/);
  const captured = call('capture', { ...run, raw, finishReason: 'unknown' });
  assert.equal(captured.delivery, 'REVIEW_WITHOUT_STOP_RECEIPT');
  assert.deepEqual(call('capture', { ...run, raw, finishReason: 'unknown' }), captured);
  const truncated = call('prepare', { ...base, runId: 'truncated' });
  const incomplete = { ...run, runId: truncated.runId, runSha256: truncated.runSha256 };
  const short = call('capture', { ...incomplete, raw, finishReason: 'length' });
  assert.equal(short.delivery, 'INCOMPLETE_RAW');
  assert.equal(readSavedRaw(vault, incomplete).raw, raw);
  assert.equal(call('draft', { ...incomplete, rawSha256: short.rawSha256, changes }).decision, 'INCOMPLETE_RAW');

  const draftInput = { ...run, rawSha256: captured.rawSha256, changes };
  const draft = call('draft', draftInput);
  assert.equal(draft.decision, 'REVIEW_REQUIRED');
  assert.deepEqual(call('draft', draftInput), draft);
  assert.deepEqual(call('status', run).draftHashes, [draft.draftSha256]);
  fails('audit', { ...run, report: { ...exampleReview, draftSha256: 'a'.repeat(64) } }, /was not prepared/);
  const review = (version, report) => call('audit', { ...run, report: { ...report, draftSha256: version.draftSha256 } });
  const original = review(draft, exampleReview);
  assert.equal(original.decision, 'AUTHOR_REVIEW_REQUIRED');
  assert.deepEqual(review(draft, exampleReview), original);

  const edit = (candidateSha256, quote, text) => {
    const task = call('rework-plan', { ...run, candidateSha256, issues: [{
      target: { quote }, authorNote: '固定离线反馈', categories: ['DIRECT_EXPOSITION'], impact: 'SURFACE',
      diagnosis: '用现有片段回放替换范围', strategy: '只改标出的句子', preserve: ['保留伙计目击'],
    }] });
    assert.equal(task.decision, 'AUTHOR_REWORK_READY');
    return call('draft', { ...draftInput, editReceipt: task.editReceipt,
      replacement: { editorRef: 'fixture-editor', patches: [{ id: 'issue-1', text }] } });
  };
  const roundReport = (version, quote, decision, priorBlockers) => ({
    ...exampleReview,
    checks: exampleReview.checks.map((check) => ({ ...check, quote })),
    reading: { ...exampleReview.reading, quote, keep: { ...exampleReview.reading.keep, quote } },
    rework: { reviewer: 'fixture-rework-reviewer', reworkSha256: version.reworkSha256, findings: [{
      id: 'issue-1', decision, quote, result: '离线回放已有逐字选段',
      preservation: [{ constraint: '保留伙计目击', decision: 'PASS', note: '保持知情证据' }],
    }] },
    ...(priorBlockers && { priorBlockers }),
  });
  const first = edit(original.candidateSha256, '伙计看见了', '伙计也看见了');
  const failed = review(first, roundReport(first, '伙计也看见了', 'BLOCK'));
  assert.equal(failed.decision, 'QUALITY_BLOCKED');
  const second = edit(failed.candidateSha256, '伙计也看见了', '伙计在旁看见了');
  fails('audit', { ...run, report: { ...roundReport(second, '伙计在旁看见了', 'PASS'),
    draftSha256: second.draftSha256 } }, /parent version blockers/);
  const revised = review(second, roundReport(second, '伙计在旁看见了', 'PASS', second.proof.pendingParentBlockers
    .map((key) => ({ key, decision: 'PASS', quote: '伙计在旁看见了', note: '再次核对这个问题。' }))));
  const saved = readReworkHistory(vault, { ...run, candidateSha256: revised.candidateSha256 });
  assert.equal(saved.source, first.final);
  assert.equal(rollbackAuthorRework({ revised: saved.final, receipt: saved.diff }).original, first.final);
  assert.equal(readReworkHistory(vault, run).versions.length, 3);
  const select = (candidateSha256, expectedEventSha256) => selectReworkVersion(vault, {
    ...run, candidateSha256, expectedEventSha256, authorRef: 'offline-authorship-fixture',
  });
  assert.throws(() => select(failed.candidateSha256, revised.eventSha256), /unblocked version/);
  const previous = select(original.candidateSha256, revised.eventSha256);
  const current = select(revised.candidateSha256, previous.selectionSha256);
  const approve = (candidateSha256, selectionSha256) => approveCanon(vault, {
    ...run, candidateSha256, selectionSha256, authorRef: 'offline-authorship-fixture', manualDeliveryReviewed: true,
  });
  assert.throws(() => approve(original.candidateSha256, previous.selectionSha256), /selection is stale/);
  assert.equal(approve(revised.candidateSha256, current.selectionSha256).decision, 'CANON_APPROVED');
  assert.equal(approve(revised.candidateSha256, current.selectionSha256).decision, 'ALREADY_APPROVED');
  fails('prepare', base, /Stale run baseline/);
  fails('draft', draftInput, /Stale run baseline/);
  assert.equal(call('status', run).decision, 'RUN_BASELINE_CLOSED');
  const canon = readCanon(vault, bookId);
  const next = call('prepare', { ...base, runId: 'next-chapter', brief: undefined,
    plan: { ...base.plan, chapter: 2, parentVersion: canon.version, requiredFactKeys: [changes[0].key] } });
  assert.equal(next.plan.context.facts[changes[0].key].sourceDraftSha256, saved.finalSha256);
  assert.equal(next.plan.context.previousTail, saved.final);
});

test('a captured receipt arriving later invalidates a pending draft until it is prepared again', async (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'novelos-local-run-receipt-'));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const script = await import('../NovelOS/tools/pro/run.mjs');
  const [example, handoff, report] = await Promise.all([
    load('canon-candidate.example.json'), load('chapter-handoff.example.json'), load('quality-review.example.json'),
  ]);
  const { bookId, chapter, runId, parentVersion, raw, changes } = example;
  const run = script.prepareRun(vault, { bookId, runId, brief: handoff.brief, dueDecisions: [],
    plan: { chapter, parentVersion, risks: [], requiredFactKeys: [] } });
  const context = { bookId, runId, runSha256: run.runSha256 };
  const { rawSha256 } = script.captureRun(vault, { ...context, raw });
  const first = script.prepareDraft(vault, { ...context, changes, rawSha256 });
  saveDeliveryReceipt(vault, { bookId, chapter, runId, parentVersion, rawSha256,
    packetSha256: run.packetSha256, handoffSha256: run.handoffSha256,
    scope: 'UPSTREAM_REQUEST_AND_RESPONSE', requestId: 'fake-offline-receipt',
    actualModel: 'feelfish/gemini-4-carbon', effort: 'medium', maxOutputTokens: 12288, finishReason: 'stop' });
  assert.throws(() => script.reviewDraft(vault, { ...context, report: { ...report, draftSha256: first.draftSha256 } }),
    /Delivery evidence changed/);
  const current = script.prepareDraft(vault, { ...context, changes, rawSha256 });
  assert.notEqual(first.draftSha256, current.draftSha256);
  assert.equal(script.reviewDraft(vault, { ...context, report: { ...report, draftSha256: current.draftSha256 } })
    .manualDeliveryReviewRequired, false);
});
