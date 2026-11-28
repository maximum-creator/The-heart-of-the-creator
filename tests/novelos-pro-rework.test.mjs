import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyEdit } from '../NovelOS/tools/pro/workflow.mjs';
import { planAuthorRework, checkAuthorRework, rollbackAuthorRework } from '../NovelOS/tools/pro/rework.mjs';
import { approveCanon, describeCandidate, readCanon, readReworkHistory, reviewCandidate, saveQualityReview,
  saveReworkVersion, selectReworkVersion, stageCandidate } from '../NovelOS/tools/pro/canon.mjs';
import { fixtureQuality, stageWithFixtureQuality } from './fixtures/pro-quality.mjs';

const hash = (s) => createHash('sha256').update(s).digest('hex');
const issue = (target, additional = {}) => ({
  target, authorNote: '这段 AI 味太重，直给而且冗余。', categories: ['AI_VOICE', 'DIRECT_EXPOSITION', 'REDUNDANCY'],
  impact: 'SURFACE', diagnosis: '动作已交代结果，随后重复解释。',
  preserve: ['保留动作及其发生顺序', '保留本段建立的知情范围'], strategy: '收掉重述，保留必要动作。',
  ...additional,
});
const plan = (prose, issues) => planAuthorRework({ prose, proseSha256: hash(prose), issues });
function inspection(applied, order) {
  return { reviewer: 'independent-review-fixture', reworkSha256: applied.reworkSha256,
    findings: applied.changes.map(({ id, after }) => ({
      id, decision: 'PASS', quote: after || null, result: '合成测试验证逐段对应。',
      preservation: order.issues.find((row) => row.id === id).preserve.map((constraint) =>
        ({ constraint, decision: 'PASS', note: '合成测试验证保护项覆盖。' })),
    })) };
}

test('scoped author rework fixes multiple passages on the same source and reverses exactly', () => {
  const prose = '第一章 夹具\r\n\r\n局部测试甲。\r\n局部测试乙。\r\n\r\n未选段落。\r\n\r\n局部测试丙。';
  const issues = [issue({ firstLine: 3, lastLine: 4 }), issue({ quote: '局部测试丙。' })];
  const { order } = plan(prose, issues);
  const replacement = { editorRef: 'editor-fixture', patches: [
    { id: 'issue-1', text: '局部测试甲。' }, { id: 'issue-2', text: '' },
  ] };
  const result = applyEdit({ prose, order, replacement });
  assert.equal(result.revised, '第一章 夹具\r\n\r\n局部测试甲。\r\n\r\n未选段落。\r\n\r\n');
  assert.equal(rollbackAuthorRework({ revised: result.revised, receipt: result }).original, prose);
  assert.throws(() => rollbackAuthorRework({ revised: result.revised + '变更', receipt: result }), /differs from/);
  assert.throws(() => rollbackAuthorRework({ revised: result.revised, receipt: { ...result, orderSha256: 'altered' } }), /altered/);
  assert.throws(() => applyEdit({ prose: prose + '变更', order, replacement }), /source version/);
  const altered = structuredClone(order);
  altered.issues[0].start += 1;
  assert.throws(() => applyEdit({ prose, order: altered, replacement }), /altered/);
  assert.throws(() => plan(prose, [issue({ quote: '第一章 夹具' })]), /after the title/);
  assert.throws(() => plan(prose, [...issues, issue({ quote: '局部测试乙。' })]), /Overlapping/);
  assert.throws(() => plan(prose + '局部测试丙。', [issue({ quote: '局部测试丙。' })]), /ambiguous/);
  assert.equal(plan(prose, [issue({ quote: '局部测试丙。' }, { impact: 'SCENE' })]).decision, 'RETURN_TO_ARCHITECT');
  assert.equal(plan(prose, [issue({ quote: '局部测试丙。' }, { impact: 'CANON' })]).decision, 'RETURN_TO_CONTINUITY');
  const report = inspection(result, order);
  assert.equal(checkAuthorRework({ prose, order, replacement, report }).decision, 'REWORK_REVIEWED');
  assert.throws(() => checkAuthorRework({ prose, order, replacement, report: { ...report, reviewer: 'editor-fixture' } }), /different reviewer/);
  const missing = structuredClone(report);
  missing.findings[0].preservation.pop();
  assert.throws(() => checkAuthorRework({ prose, order, replacement, report: missing }), /every protected/);
  report.findings[0].preservation[0].decision = 'BLOCK';
  assert.equal(checkAuthorRework({ prose, order, replacement, report }).decision, 'REWORK_BLOCKED');
});

test('Canon quality reports bind author feedback, actual diffs and independent rework checks', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novelos-rework-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidate = JSON.parse(fs.readFileSync(new URL('../pro/canon-candidate.example.json', import.meta.url), 'utf8'));
  const source = candidate.final;
  const { order } = plan(source, [issue({ quote: '伙计看见了' })]);
  const replacement = { editorRef: 'fixture-editor', patches: [{ id: 'issue-1', text: '伙计也看见了' }] };
  candidate.edit = { order, replacement };
  const applied = applyEdit({ prose: source, ...candidate.edit });
  candidate.final = applied.revised;
  const proof = describeCandidate(root, candidate);
  candidate.audit.finalSha256 = proof.finalSha256;
  const quality = fixtureQuality(root, candidate);
  assert.throws(() => saveQualityReview(root, { candidate, report: quality }), /Missing independent rework report/);
  quality.rework = inspection(applied, order);
  const saved = saveQualityReview(root, { candidate, report: quality });
  assert.equal(saved.decision, 'QUALITY_REVIEW_SAVED');
  assert.equal(stageCandidate(root, candidate).decision, 'CANDIDATE_STAGED');
  const review = reviewCandidate(root, candidate);
  assert.equal(review.edit.authorFeedback[0].authorNote, order.issues[0].authorNote);
  assert.equal(review.edit.changes[0].before, '伙计看见了');
  assert.equal(review.edit.changes[0].after, '伙计也看见了');
  assert.equal(review.proof.quality.rework.reworkSha256, applied.reworkSha256);
});

test('failed versions remain visible; further edits and approval target the exact selected branch', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novelos-rework-history-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = JSON.parse(fs.readFileSync(new URL('../pro/canon-candidate.example.json', import.meta.url), 'utf8'));
  const { bookId, runId } = base;
  const target = { bookId, runId };
  const original = stageWithFixtureQuality(root, base);

  function child(parent, parentCandidateSha256, quote, text) {
    const { order } = plan(parent.final, [issue({ quote })]);
    const replacement = { editorRef: 'fixture-editor', patches: [{ id: 'issue-1', text }] };
    const receipt = applyEdit({ prose: parent.final, order, replacement });
    const candidate = { ...parent, parentCandidateSha256, edit: { order, replacement }, final: receipt.revised };
    const proof = describeCandidate(root, candidate);
    candidate.audit = { ...parent.audit, finalSha256: proof.finalSha256 };
    const version = saveReworkVersion(root, candidate);
    return { candidate, version, order, receipt, replacement };
  }
  function qualityFor(round) {
    return { ...fixtureQuality(root, round.candidate), rework: inspection(round.receipt, round.order) };
  }

  const first = child(base, original.candidateSha256, '伙计看见了', '伙计也看见了');
  const failed = qualityFor(first);
  failed.rework.findings[0].decision = 'BLOCK';
  saveQualityReview(root, { candidate: first.candidate, report: failed });
  let history = readReworkHistory(root, target);
  const authorRef = 'offline author fixture';
  const select = (candidateSha256, expectedEventSha256) =>
    selectReworkVersion(root, { ...target, candidateSha256, expectedEventSha256, authorRef });
  const approve = (candidateSha256, selectionSha256) =>
    approveCanon(root, { ...target, candidateSha256, selectionSha256, authorRef, manualDeliveryReviewed: true });
  assert.throws(() => select(first.version.candidateSha256, history.decisionHistoryHead.eventSha256), /unblocked version/);
  assert.throws(() => approve(original.candidateSha256), /selection is stale or missing/);

  const second = child(first.candidate, first.version.candidateSha256, '伙计也看见了', '伙计在旁看见了');
  const competing = child(first.candidate, first.version.candidateSha256, '伙计也看见了', '伙计亲眼看见了');
  const quality = qualityFor(second);
  assert.throws(() => saveQualityReview(root, { candidate: second.candidate, report: quality }), /parent version blockers/);
  const keys = describeCandidate(root, second.candidate).pendingParentBlockers;
  assert.deepEqual(keys, [first.version.candidateSha256 + '/rework:issue-1']);
  quality.priorBlockers = keys.map((key) => ({ key, decision: 'PASS', quote: '伙计在旁看见了', note: '离线逐项复查。' }));
  saveQualityReview(root, { candidate: second.candidate, report: quality });
  history = readReworkHistory(root, target);
  assert.equal(history.versions.length, 4);
  assert.deepEqual(history.versions.map(({ round }) => round), [0, 1, 2, 2]);
  assert.equal(history.versions.find((v) => v.candidateSha256 === first.version.candidateSha256).qualityStatus, 'QUALITY_BLOCKED');
  assert.equal(history.versions.find((v) => v.candidateSha256 === competing.version.candidateSha256).qualityStatus, 'QUALITY_REPORT_MISSING');
  const saved = readReworkHistory(root, { ...target, candidateSha256: second.version.candidateSha256 });
  assert.equal(saved.source, first.candidate.final);
  assert.equal(saved.diff.changes[0].before, '伙计也看见了');
  assert.equal(saved.diff.changes[0].after, '伙计在旁看见了');
  assert.equal(rollbackAuthorRework({ revised: saved.final, receipt: saved.diff }).original, first.candidate.final);

  const selectedOriginal = select(original.candidateSha256, history.decisionHistoryHead.eventSha256);
  const selectedSecond = select(second.version.candidateSha256, selectedOriginal.selectionSha256);
  assert.throws(() => select(original.candidateSha256, selectedOriginal.selectionSha256), /selection changed/);
  assert.throws(() => approve(original.candidateSha256, selectedOriginal.selectionSha256), /selection is stale/);
  assert.throws(() => approve(second.version.candidateSha256, selectedOriginal.selectionSha256), /selection is stale/);
  const rolledBack = select(original.candidateSha256, selectedSecond.selectionSha256);
  assert.equal(reviewCandidate(root, target).final, base.final);
  assert.throws(() => approve(original.candidateSha256, selectedOriginal.selectionSha256), /selection is stale/);
  const withdrawn = select(null, rolledBack.selectionSha256);
  assert.equal(withdrawn.decision, 'REWORK_SELECTION_WITHDRAWN');
  assert.throws(() => approve(original.candidateSha256, rolledBack.selectionSha256), /selection is stale/);
  const cli = fileURLToPath(new URL('../NovelOS/tools/pro/canon.mjs', import.meta.url));
  const race = (candidateSha256, index) => new Promise((resolve, reject) => {
    const file = path.join(root, 'selection-' + index + '.json');
    fs.writeFileSync(file, JSON.stringify({ ...target, candidateSha256, expectedEventSha256: withdrawn.eventSha256, authorRef }));
    const processHandle = spawn(process.execPath, [cli, 'rework-select', root, file], { stdio: 'ignore' });
    processHandle.on('error', reject);
    processHandle.on('exit', resolve);
  });
  const results = await Promise.all([race(original.candidateSha256, 1), race(second.version.candidateSha256, 2)]);
  assert.deepEqual(results.sort(), [0, 1]);
  const finalSelection = select(second.version.candidateSha256, readReworkHistory(root, target).decisionHistoryHead.eventSha256);
  assert.equal(reviewCandidate(root, target).edit.changes[0].before, '伙计也看见了');
  assert.equal(approve(second.version.candidateSha256, finalSelection.selectionSha256).decision, 'CANON_APPROVED');
  assert.equal(approve(second.version.candidateSha256, finalSelection.selectionSha256).decision, 'ALREADY_APPROVED');
  assert.equal(readCanon(root, bookId).final, saved.final);
  assert.equal(readReworkHistory(root, { ...target, candidateSha256: original.candidateSha256 }).final, base.final);
  assert.throws(() => select(original.candidateSha256, selectedSecond.selectionSha256), /run is closed/);
});
