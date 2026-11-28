import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { test } from 'node:test';
import { evaluateWorkReadiness, workProfiles } from '../NovelOS/tools/pro/work-readiness.mjs';

const example = JSON.parse(fs.readFileSync(new URL('../pro/templates/work-readiness.example.json', import.meta.url), 'utf8'));
const { story } = example;
const artifact = '离线证据夹具：公开交还物件。';
const artifactSha256 = createHash('sha256').update(artifact).digest('hex');
const scene = { id: 'scene-01', place: '示例地点', time: '示例时间', actionQuote: artifact, estimatedSeconds: 40, assets: ['物件'] };
const request = (format, risks = []) => ({ format, story, unit: {
  ...example.unit, risks,
  ...(format !== 'NOVEL' && { productionLimit: '单景用现有物件' }),
  ...(format === 'VERTICAL_DRAMA' && { maxSeconds: 60 }),
} });
const checkedReview = (input, plan) => ({
  scope: 'OFFLINE_FIXTURE', workPlanSha256: plan.workPlanSha256, artifactSha256,
  checks: workProfiles[input.format].checks.map((id) => ({ id, decision: 'PASS', quote: artifact, note: '仅用于检查证据绑定' })),
  ...(input.format !== 'NOVEL' && { scenes: [scene] }),
});

test('four formats share the story identity while dispatch and production limits match their format', () => {
  const identities = new Set();
  const plans = new Set();
  for (const format of Object.keys(workProfiles)) {
    const input = request(format, format === 'NOVEL' ? [] : ['scene_design']);
    const result = evaluateWorkReadiness(input);
    assert.equal(result.decision, 'READY_TO_PLAN_DRAFT');
    assert.equal(result.marketBasis, 'POSITIONING_HYPOTHESIS');
    identities.add(result.storyPlanSha256);
    plans.add(result.workPlanSha256);
    assert.equal(result.order.dispatch.writer, 'novelos-pro-gemini');
    assert.equal(result.order.dispatch.tools, 'LOCAL_MCP');
    assert.equal(result.order.dispatch.approval, 'AUTHOR');
    assert.equal(result.order.dispatch.afterDraft.includes('novelos-pro-reader'), format !== 'NOVEL');
    assert.equal(evaluateWorkReadiness({ ...input, artifact, review: checkedReview(input, result) }).decision, 'OFFLINE_ONLY');
  }
  assert.equal(identities.size, 1);
  assert.equal(plans.size, 4);
  const routineScript = evaluateWorkReadiness(request('VERTICAL_DRAMA'));
  assert.deepEqual(routineScript.order.dispatch.beforeDraft, []);
  assert.ok(!routineScript.order.dispatch.afterDraft.includes('novelos-pro-reader'));
  const creativeOnly = evaluateWorkReadiness(request('VERTICAL_DRAMA', ['creative_difficulty']));
  assert.deepEqual(creativeOnly.order.dispatch.beforeDraft, ['novelos-pro-opus']);
  assert.ok(creativeOnly.order.dispatch.afterDraft.includes('novelos-pro-reader'));
  const work = evaluateWorkReadiness(request('LONG_DRAMA', ['creative_difficulty', 'cross_unit_conflict']));
  assert.deepEqual(work.order.dispatch.beforeDraft, ['novelos-pro-arbiter', 'novelos-pro-opus', 'novelos-pro-dramaturg']);
  const broken = { ...story, beats: [story.beats[0]] };
  const missing = evaluateWorkReadiness({ ...request('NOVEL'), story: broken });
  assert.equal(missing.decision, 'RETURN_TO_DEVELOPMENT');
  assert.equal(missing.order, undefined);
  assert.ok(missing.missing.includes('story.beats.CHOICE.cost'));
});

test('stale text, missing feedback, format failures, and author decisions fail closed', () => {
  const input = request('VERTICAL_DRAMA');
  const plan = evaluateWorkReadiness(input);
  const review = checkedReview(input, plan);
  const call = (overrides, final = artifact) => evaluateWorkReadiness({ ...input, artifact: final, review: { ...review, ...overrides } });
  assert.equal(call({}, artifact + '变更').decision, 'STALE_REVIEW');
  assert.equal(call({ checks: review.checks.slice(1) }).decision, 'REVIEW_INCOMPLETE');
  assert.equal(call({ scenes: [] }).decision, 'REVIEW_INCOMPLETE');
  assert.equal(call({ scenes: [{ ...scene, estimatedSeconds: 90 }] }).decision, 'RETURN_FOR_REVISION');
  assert.equal(call({ scope: 'LIVE_REVIEW' }).decision, 'LIVE_EVIDENCE_REQUIRED');
  const live = {
    scope: 'LIVE_REVIEW', audience: { kind: 'TARGET_VIEWERS', sourceRef: 'fixture-observation', participants: 5, wantContinue: 4 },
    production: { kind: 'TABLE_READ', sourceRef: 'fixture-read', decision: 'PASS', note: '仅演练报告状态' },
    authorReworkMinutes: 30,
  };
  assert.equal(call({ ...live, authorReworkMinutes: 90 }).decision, 'PROJECT_CRITERIA_NOT_MET');
  const author = call(live);
  assert.equal(author.decision, 'AUTHOR_REVIEW_REQUIRED');
  assert.equal(call({ ...live, author: { decision: 'APPROVE', sourceRef: 'fixture-author', reviewSha256: author.reviewSha256 } }).decision,
    'AUTHOR_APPROVAL_RECORDED');
  const changed = { ...live, authorReworkMinutes: 31, author: { decision: 'APPROVE', sourceRef: 'fixture-author', reviewSha256: author.reviewSha256 } };
  assert.equal(call(changed).decision, 'AUTHOR_REVIEW_REQUIRED');
  assert.equal(evaluateWorkReadiness({ ...input, artifact, unit: { ...input.unit,
    acceptance: { ...input.unit.acceptance, minParticipants: 3 } }, review: { ...review, ...live } }).decision, 'STALE_REVIEW');
});
