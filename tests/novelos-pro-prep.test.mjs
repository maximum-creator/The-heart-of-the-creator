import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { describeCandidate, prepareChapter } from '../NovelOS/tools/pro/canon.mjs';
import { planChapter } from '../NovelOS/tools/pro/dispatch.mjs';
import { prepareCastActions } from '../NovelOS/tools/pro/story-prep.mjs';
import { evaluateWorkReadiness } from '../NovelOS/tools/pro/work-readiness.mjs';

const load = (name) => JSON.parse(fs.readFileSync(new URL('../pro/' + name, import.meta.url), 'utf8'));

test('positioning distinguishes relevant reader signals from hype, wrong scope and old or sparse samples', () => {
  const input = load('templates/positioning.example.json');
  assert.equal(evaluateWorkReadiness(input).marketBasis, 'POSITIONING_HYPOTHESIS');
  const { audience, positioning } = input.story;
  const observed = { kind: 'PLATFORM_DATA', source: 'offline-fixture', observation: 'coverage check only',
    platform: audience.platform, segment: audience.segment, stage: positioning.stage, observedOn: '2026-11-15',
    sampleSize: 6, signal: 'DISCOVERY', direction: 'FAVORABLE' };
  audience.evidence.push(observed, { ...observed, sampleSize: 1 }, { ...observed, observedOn: '2025-10-01' },
    { ...observed, observedOn: '2026-11-29' }, { ...observed, stage: '完结' },
    { ...observed, kind: 'COMPARABLE' });
  const limited = evaluateWorkReadiness(input);
  assert.equal(limited.decision, 'POSITIONING_REVIEW');
  assert.equal(limited.marketBasis, 'LIMITED_MARKET_EVIDENCE');
  assert.deepEqual(limited.positioningEvidence.missingSignals, ['CONTINUATION']);
  assert.deepEqual(limited.positioningEvidence.unmatched.map(({ reason }) => reason), [
    'CONTEXT_ONLY', 'SAMPLE_TOO_SMALL_OR_UNKNOWN', 'DATE_OUTSIDE_WINDOW', 'DATE_OUTSIDE_WINDOW', 'SCOPE_MISMATCH', 'CONTEXT_ONLY',
  ]);
  audience.evidence.push({ ...observed, signal: 'CONTINUATION', direction: 'UNFAVORABLE' });
  const scoped = evaluateWorkReadiness(input);
  assert.equal(scoped.marketBasis, 'SCOPED_MARKET_OBSERVATIONS');
  assert.deepEqual(scoped.positioningEvidence.signalSummary, { DISCOVERY: ['FAVORABLE'], CONTINUATION: ['UNFAVORABLE'] });
  assert.equal(evaluateWorkReadiness({ ...input, story: { audience, positioning: { ...positioning, firstPayoff: '' } } }).decision,
    'RETURN_TO_DEVELOPMENT');
});

test('an ensemble compiles only active character actions, binds them to approval, and leaves regular chapters lean', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novelos-prep-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const handoff = load('chapter-handoff.example.json');
  const a = { character: '宋枝', goal: '当众取回钥匙', leverage: '决定是否继续照看铺门',
    knowledgeBoundary: '只知道自己交出的钥匙', action: '当面索取', affects: '伙计', consequence: '伙计必须当场回话' };
  const b = { character: '伙计', goal: '延后交还', leverage: '仍保管钥匙', knowledgeBoundary: '知道钥匙现在的位置',
    action: '提出延后', affects: '宋枝', consequence: '宋枝需要决定是否接受代价' };
  const sceneMode = 'ENSEMBLE';
  const regular = prepareChapter(root, handoff);
  assert.equal(Object.hasOwn(regular.packet, 'castActions'), false);
  assert.equal(prepareChapter(root, { ...handoff, sceneMode: 'SINGLE_FOCUS' }).handoffSha256, regular.handoffSha256);
  const routed = planChapter(root, { bookId: handoff.bookId, chapter: handoff.chapter, parentVersion: handoff.parentVersion,
    requiredFactKeys: [], risks: [], sceneMode });
  assert.equal(routed.requiresCastActions, true);
  assert.deepEqual(routed.dispatch.beforeDraft, []);
  assert.throws(() => prepareChapter(root, { ...handoff, sceneMode }), /2–5 active/);
  assert.throws(() => prepareChapter(root, { ...handoff, castActions: [a, b] }), /require ENSEMBLE/);
  assert.throws(() => prepareChapter(root, { ...handoff, sceneMode, castActions: [a, { ...b, affects: '未出场的人' }] }), /take part/);
  const someoneElsesFact = 'knowledge:伙计.钥匙位置';
  assert.throws(() => prepareCastActions({ sceneMode, castActions: [{ ...a, knownFactKeys: [someoneElsesFact] }, b] }, [someoneElsesFact]),
    /another character/);
  const prepared = prepareChapter(root, { ...handoff, sceneMode, castActions: [a, b] });
  assert.deepEqual(prepared.packet.castActions, [a, b]);
  assert.notEqual(prepared.handoffSha256, regular.handoffSha256);
  const sample = load('canon-candidate.example.json');
  const candidate = { ...sample, handoff: prepared.handoff, packet: prepared.packet };
  assert.equal(describeCandidate(root, candidate).handoffSha256, prepared.handoffSha256);
  assert.throws(() => describeCandidate(root, { ...candidate,
    packet: { ...candidate.packet, castActions: [{ ...a, action: '未经批准的行动' }, b] } }), /differs from the prepared handoff/);
});
