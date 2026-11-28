const text = (value, max = 400) => typeof value === 'string' && Boolean(value.trim()) && [...value].length <= max;
const whole = (value, min) => Number.isSafeInteger(value) && value >= min;
const signals = ['DISCOVERY', 'CONTINUATION'];
const observedKinds = ['PLATFORM_DATA', 'TARGET_INTERVIEW'];
const day = 86400000;

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return NaN;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value ? NaN : parsed.valueOf();
}

export function assessPositioning(audience, positioning) {
  const evidence = audience.evidence;
  if (positioning === undefined) {
    return { basis: 'POSITIONING_HYPOTHESIS', accepted: [], unmatched: evidence.map((item, index) => ({ index, reason: 'NO_COMPARISON_SCOPE' })) };
  }
  const { stage, asOf, maxAgeDays, minSampleSize, clickPromise, reasonToReturn, differentiator, firstPayoff, testSignal } = positioning ?? {};
  const date = calendarDate(asOf);
  const missing = [];
  for (const [key, value] of Object.entries({ stage, clickPromise, reasonToReturn, differentiator, firstPayoff, testSignal })) {
    if (!text(value)) missing.push(key);
  }
  if (!Number.isFinite(date)) missing.push('asOf');
  if (!whole(maxAgeDays, 1) || maxAgeDays > 730) missing.push('maxAgeDays');
  if (!whole(minSampleSize, 1)) missing.push('minSampleSize');
  if (missing.length) return { basis: 'POSITIONING_INCOMPLETE', missing };

  const accepted = [];
  const unmatched = [];
  for (const [index, item] of evidence.entries()) {
    const observed = calendarDate(item.observedOn);
    let reason;
    if (!observedKinds.includes(item.kind)) reason = 'CONTEXT_ONLY';
    else if (item.platform !== audience.platform || item.segment !== audience.segment || item.stage !== stage) reason = 'SCOPE_MISMATCH';
    else if (!Number.isFinite(observed) || observed > date || (date - observed) / day > maxAgeDays) reason = 'DATE_OUTSIDE_WINDOW';
    else if (!whole(item.sampleSize, minSampleSize)) reason = 'SAMPLE_TOO_SMALL_OR_UNKNOWN';
    else if (!signals.includes(item.signal) || !['FAVORABLE', 'UNFAVORABLE', 'MIXED'].includes(item.direction)) reason = 'SIGNAL_UNCLASSIFIED';
    if (reason) unmatched.push({ index, reason });
    else accepted.push({ index, signal: item.signal, direction: item.direction });
  }
  const covered = new Set(accepted.map(({ signal }) => signal));
  const missingSignals = signals.filter((signal) => !covered.has(signal));
  const signalSummary = Object.fromEntries(signals.map((signal) => [signal,
    [...new Set(accepted.filter((row) => row.signal === signal).map(({ direction }) => direction))]]));
  return {
    basis: accepted.length === 0 ? 'POSITIONING_HYPOTHESIS'
      : missingSignals.length ? 'LIMITED_MARKET_EVIDENCE' : 'SCOPED_MARKET_OBSERVATIONS',
    stage, accepted, unmatched, missingSignals, signalSummary,
  };
}

export function validateCastActions(actions) {
  if (!Array.isArray(actions) || actions.length < 2 || actions.length > 5) return ['castActions: choose 2–5 active characters'];
  const errors = [];
  const characters = new Set();
  const allowed = ['character', 'goal', 'leverage', 'knowledgeBoundary', 'action', 'affects', 'consequence', 'knownFactKeys'];
  for (const [index, item] of actions.entries()) {
    const { character, goal, leverage, knowledgeBoundary, action, affects, consequence, knownFactKeys } = item ?? {};
    if (Object.keys(item ?? {}).some((key) => !allowed.includes(key))) errors.push('castActions[' + index + ']: unknown field');
    if (!text(character, 40) || characters.has(character)) errors.push('castActions[' + index + '].character');
    characters.add(character);
    for (const [key, value] of Object.entries({ goal, leverage, knowledgeBoundary, action, consequence })) {
      if (!text(value, 110)) errors.push('castActions[' + index + '].' + key);
    }
    if (!text(affects, 40) || affects === character) errors.push('castActions[' + index + '].affects');
    if (knownFactKeys !== undefined && (!Array.isArray(knownFactKeys) || knownFactKeys.length > 3
      || new Set(knownFactKeys).size !== knownFactKeys.length || knownFactKeys.some((key) => !text(key, 128)))) {
      errors.push('castActions[' + index + '].knownFactKeys');
    }
  }
  for (const [index, item] of actions.entries()) {
    if (!characters.has(item?.affects)) errors.push('castActions[' + index + '].affects: target must take part in this scene');
  }
  return errors;
}

export function prepareCastActions(input, factKeys) {
  const { sceneMode, castActions } = input;
  if (sceneMode === undefined && castActions === undefined) return undefined;
  if (sceneMode !== 'ENSEMBLE') {
    if (sceneMode !== 'SINGLE_FOCUS' || castActions !== undefined) throw new Error('Cast actions require ENSEMBLE scene mode');
    return undefined;
  }
  const errors = validateCastActions(castActions);
  if (errors.length) throw new Error(errors.join(', '));
  return castActions.map(({ character, goal, leverage, knowledgeBoundary, action, affects, consequence, knownFactKeys = [] }) => {
    if (knownFactKeys.some((key) => !factKeys.includes(key)
      || (key.startsWith('knowledge:') && !key.startsWith('knowledge:' + character + '.')))) {
      throw new Error('Cast member cites an unselected or another character’s knowledge fact: ' + character);
    }
    return { character, goal, leverage, knowledgeBoundary, action, affects, consequence,
      ...(knownFactKeys.length && { knownFactKeys: [...knownFactKeys].sort() }) };
  });
}
