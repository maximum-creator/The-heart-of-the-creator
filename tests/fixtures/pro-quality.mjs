import { describeCandidate, saveQualityReview, stageCandidate } from '../../NovelOS/tools/pro/canon.mjs';

export function fixtureQuality(root, candidate) {
  const { dependencies } = describeCandidate(root, candidate);
  const quote = candidate.final.split(/\r?\n/u).slice(1).find((line) => line.trim());
  const note = '离线夹具用于核对引用及版本绑定。';
  const judgment = { decision: 'PASS', note };
  return {
    reviewer: 'fixture-continuity',
    checks: ['continuity', 'viewpoint', 'causality'].map((aspect) => ({ aspect, quote, ...judgment })),
    inherited: Object.entries(dependencies?.facts ?? {}).map(([key, source]) => ({
      key, sourceChapter: source.chapter, sourceDraftSha256: source.sourceDraftSha256, sourceQuote: source.quote, ...judgment,
    })),
    stateChanges: candidate.changes.map(({ key, quote }) => ({ key, quote, ...judgment })),
    reading: { reviewer: 'fixture-reader', quote, ...judgment, keep: { quote, note } },
  };
}

export function stageWithFixtureQuality(root, candidate) {
  saveQualityReview(root, { candidate, report: fixtureQuality(root, candidate) });
  return stageCandidate(root, candidate);
}
