const aspects = ['continuity', 'viewpoint', 'causality'];
const decisions = ['PASS', 'AUTHOR_REVIEW', 'BLOCK'];
const fail = (message) => { throw new Error(message); };
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function validateQualityReview(candidate, dependencies, report) {
  const locate = (quote) => {
    const index = text(quote, 320) && quote.trim().length >= 4 ? candidate.final.indexOf(quote) : -1;
    if (index < 0) {
      fail('Quality review quote is missing from the final prose');
    }
    if (candidate.final.indexOf(quote, index + 1) !== -1) fail('Quality review quote must uniquely locate the passage');
    return { quote, line: candidate.final.slice(0, index).split('\n').length };
  };
  const { reviewer, checks, inherited, stateChanges, reading } = report ?? {};
  if (!text(reviewer, 100) || !Array.isArray(checks) || checks.length !== aspects.length
    || new Set(checks.map((check) => check?.aspect)).size !== aspects.length) fail('Incomplete continuity review');
  function reviewItem(item) {
    if (!item || !decisions.includes(item.decision) || !text(item.note, 800)) fail('Invalid quality review judgment');
    return { decision: item.decision, ...locate(item.quote), note: item.note };
  }
  const checked = aspects.map((aspect) => ({ aspect, ...reviewItem(checks.find((item) => item?.aspect === aspect)) }));

  const sources = dependencies?.facts ?? {};
  function coverage(rows, keys, name, sourceCheck) {
    if (!Array.isArray(rows) || rows.length !== keys.length || new Set(rows.map((item) => item?.key)).size !== keys.length) {
      fail('Incomplete review coverage: ' + name);
    }
    return keys.map((key) => {
      const item = rows.find((row) => row?.key === key);
      if (!item || !decisions.includes(item.decision) || !text(item.note, 800)) fail('Missing review judgment: ' + key);
      return { key, decision: item.decision, note: item.note, ...sourceCheck(item, key) };
    });
  }
  const inheritedReview = coverage(inherited, Object.keys(sources), 'inherited facts', (item, key) => {
    const source = sources[key];
    if (item.sourceChapter !== source.chapter || item.sourceDraftSha256 !== source.sourceDraftSha256 || item.sourceQuote !== source.quote) {
      fail('Review does not cite the approved source: ' + key);
    }
    return { sourceChapter: source.chapter, sourceDraftSha256: source.sourceDraftSha256, sourceQuote: source.quote };
  });
  const changes = new Map(candidate.changes.map(({ key, quote }) => [key, quote]));
  const changeReview = coverage(stateChanges, [...changes.keys()], 'state changes', (item, key) => {
    if (item.quote !== changes.get(key)) fail('Review does not cite the proposed state change: ' + key);
    return locate(item.quote);
  });

  const requiresReading = candidate.chapter <= 3 || candidate.handoff?.requiresReading === true
    || Boolean(candidate.handoff?.dueDecisions.length);
  if (requiresReading && !reading) fail('Independent reading is required for this chapter');
  let readerReview = null;
  if (reading) {
    if (!text(reading.reviewer, 100) || reading.reviewer.trim().toLowerCase() === reviewer.trim().toLowerCase()
      || !text(reading.keep?.note, 800)) fail('Independent reading needs a different reviewer and a specific strength');
    readerReview = { reviewer: reading.reviewer, ...reviewItem(reading),
      keep: { ...locate(reading.keep.quote), note: reading.keep.note } };
  }
  const judgments = [...checked, ...inheritedReview, ...changeReview, ...(readerReview ? [readerReview] : [])];
  const hasBlocker = judgments.some((item) => item.decision === 'BLOCK');
  const authorNotes = judgments.filter((item) => item.decision === 'AUTHOR_REVIEW');
  return { reviewer, checks: checked, inherited: inheritedReview, stateChanges: changeReview, reading: readerReview, hasBlocker, authorNotes };
}
