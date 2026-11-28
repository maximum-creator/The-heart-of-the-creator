import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyEdit } from '../NovelOS/tools/pro/workflow.mjs';
import { planAuthorRework, checkAuthorRework, rollbackAuthorRework } from '../NovelOS/tools/pro/rework.mjs';
import { describeCandidate, reviewCandidate, saveQualityReview, stageCandidate } from '../NovelOS/tools/pro/canon.mjs';
import { fixtureQuality } from './fixtures/pro-quality.mjs';

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
