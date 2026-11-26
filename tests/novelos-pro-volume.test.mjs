import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { approveCanon, describeCandidate, readCanon, reviewChapterImpact, stageCandidate } from '../NovelOS/tools/pro/canon.mjs';
import { planChapter } from '../NovelOS/tools/pro/dispatch.mjs';

const packet = JSON.parse(fs.readFileSync(new URL('../pro/scene-packet.example.json', import.meta.url), 'utf8'));
const bookId = 'volume-fixture';
const key = 'promise:铺门公开交还';
const thread = { id: '铺门旧账', dueChapter: 24, status: 'open' };
const seed = '她当众答应月底交还钥匙。';
const payoff = '到月底，她当众交还了钥匙。';

test('an offline 24-chapter volume preserves the seed, detects payoff, tracks revisions and hands off to the next volume', (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-volume-'));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  let head = readCanon(vault, bookId);
  const plan = (requiredFactKeys = [], risks = [], activeThreads = []) => planChapter(vault,
    { bookId, chapter: head.chapter + 1, parentVersion: head.version, requiredFactKeys, risks, activeThreads });

  function prepare(chapter, sentence, changes = [], evidenceKeys = []) {
    const context = plan(evidenceKeys).context;
    const final = '第' + chapter + '章 离线夹具\n\n' + sentence;
    const candidate = { bookId, runId: 'run-' + chapter, chapter, parentVersion: head.version,
      packet: { ...packet, previousTail: context.previousTail }, final, raw: final + '\n[NOVELOS END]',
      evidenceKeys, changes, finishReason: 'unknown' };
    if (chapter === 3) delete candidate.evidenceKeys;
    const proof = describeCandidate(vault, candidate);
    candidate.audit = { decision: 'PASS', parentVersion: head.version, finalSha256: proof.finalSha256,
      changesSha256: proof.changesSha256, evidenceSha256: proof.evidenceSha256, evidenceRef: 'offline-volume/' + chapter };
    return candidate;
  }

  function approve(candidate) {
    const staged = stageCandidate(vault, candidate);
    const result = approveCanon(vault, { bookId, runId: candidate.runId, candidateSha256: staged.candidateSha256,
      authorRef: 'offline fixture only', manualDeliveryReviewed: true });
    assert.equal(result.decision, 'CANON_APPROVED');
    head = readCanon(vault, bookId);
  }

  const initial = prepare(1, seed, [{ key, before: null, after: '等月底交还钥匙', quote: seed, thread }]);
  const staleAudit = { ...initial, audit: { ...initial.audit, evidenceSha256: 'f'.repeat(64) } };
  assert.throws(() => stageCandidate(vault, staleAudit), /Matching continuity audit/);
  assert.throws(() => stageCandidate(vault, { ...initial, packet: { ...initial.packet, readerPromise: '换一条承诺' } }), /Matching continuity audit/);
  approve(initial);
  const seedHash = head.finalSha256;
  assert.equal(plan().context.suggestedEvidence.length, 0);
  assert.equal(plan([], [], [thread.id]).context.suggestedEvidence[0].fact.quote, seed);
  assert.throws(() => describeCandidate(vault, { ...prepare(2, '她在门口停了一下。'),
    changes: [{ key, before: '等月底交还钥匙', after: null, quote: '她在门口停了一下。' }] }), /Resolve an open story thread/);
  assert.throws(() => describeCandidate(vault, { ...prepare(2, '她在门口停了一下。'), evidenceKeys: ['knowledge:不存在'] }),
    /missing from approved/);

  for (let chapter = 2; chapter < 24; chapter += 1) {
    approve(prepare(chapter, '她在门口停了一下。', [], chapter === 8 ? [key] : []));
  }
  const due = plan();
  assert.equal(due.mode, 'STANDARD');
  assert.equal(due.context.dueCount, 1);
  assert.equal(due.context.suggestedEvidence[0].fact.sourceDraftSha256, seedHash);
  assert.equal(due.context.suggestedEvidence[0].fact.chapter, 1);
  assert.equal(plan([key]).context.suggestedEvidence.length, 0);
  assert.equal(plan([key]).mode, 'STANDARD');
  const finale = plan([key], ['volume_end']);
  assert.equal(finale.dispatch.beforeDraft[0], 'novelos-pro-arbiter');
  approve(prepare(24, payoff, [{ key, before: '等月底交还钥匙', after: '已经当众归还钥匙', quote: payoff,
    thread: { ...thread, status: 'resolved' } }], [key]));
  const next = plan([key], [], [thread.id]);
  assert.equal(next.mode, 'FAST');
  assert.equal(next.context.dueCount, 0);
  assert.equal(next.context.facts[key].threadOrigin.quote, seed);
  assert.equal(next.context.facts[key].quote, payoff);
  assert.equal(next.context.previousTail, head.final);
  const stagedNext = stageCandidate(vault, prepare(25, '她推开铺门。', [], [key]));

  const proposed = { bookId, sourceChapter: 1, sourceFinalSha256: seedHash, headVersion: head.version,
    changedFactKeys: [key], previousTailChanged: true };
  const impact = reviewChapterImpact(vault, proposed);
  assert.equal(impact.decision, 'REVIEW_IMPACT');
  assert.equal(impact.approved.length, 23);
  assert.equal(impact.approved.find((entry) => entry.chapter === 2).previousTail, true);
  assert.equal(impact.approved.find((entry) => entry.chapter === 3).action, 'REVIEW_UNTRACKED');
  assert.equal(impact.approved.find((entry) => entry.chapter === 4).action, 'REVALIDATE_BASELINE');
  assert.equal(impact.approved.find((entry) => entry.chapter === 8).action, 'REVIEW_DIRECT_DEPENDENCIES');
  assert.equal(impact.approved.find((entry) => entry.chapter === 24).auditEvidence, 'offline-volume/24');
  assert.equal(impact.staged[0].candidateSha256, stagedNext.candidateSha256);
  assert.equal(impact.staged[0].action, 'REVIEW_DIRECT_DEPENDENCIES');
  assert.equal(reviewChapterImpact(vault, { ...proposed, headVersion: '0'.repeat(64) }).decision, 'STALE_BASELINE');
  assert.equal(reviewChapterImpact(vault, { ...proposed, sourceFinalSha256: '0'.repeat(64) }).decision, 'STALE_SOURCE');
  assert.equal(readCanon(vault, bookId).version, head.version);
});
