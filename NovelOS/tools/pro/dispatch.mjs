import { readChapterContext } from './canon.mjs';

const risks = [
  'creative_difficulty', 'viewpoint_change', 'relationship_turn', 'foreshadow_payoff',
  'timeline_jump', 'volume_end', 'cross_chapter_replan', 'unresolved_conflict', 'sample_review',
];
const deep = ['volume_end', 'cross_chapter_replan', 'unresolved_conflict'];
const standard = ['creative_difficulty', 'viewpoint_change', 'relationship_turn', 'foreshadow_payoff', 'timeline_jump'];

export const chapterPlanSchema = {
  type: 'object',
  properties: {
    bookId: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$' },
    chapter: { type: 'integer', minimum: 1, maximum: 99999999 },
    parentVersion: { type: 'string', pattern: '^(GENESIS|[a-f0-9]{64})$' },
    requiredFactKeys: { type: 'array', maxItems: 10, items: { type: 'string' } },
    activeThreads: { type: 'array', maxItems: 10, items: { type: 'string' } },
    risks: { type: 'array', uniqueItems: true, items: { enum: risks } },
  },
  required: ['bookId', 'chapter', 'parentVersion', 'requiredFactKeys', 'risks'],
  additionalProperties: false,
};

export function planChapter(vault, input = {}) {
  if (!vault) throw new Error('Set NOVELOS_PRO_VAULT to an existing private Canon directory');
  const { bookId, chapter, parentVersion, requiredFactKeys, risks: flags, activeThreads = [] } = input;
  if (!Number.isSafeInteger(chapter) || chapter < 1 || chapter > 99999999
    || typeof parentVersion !== 'string' || !/^(GENESIS|[a-f0-9]{64})$/u.test(parentVersion)
    || !Array.isArray(requiredFactKeys) || !Array.isArray(flags)
    || flags.length > risks.length || new Set(flags).size !== flags.length
    || flags.some((flag) => !risks.includes(flag))) throw new Error('Invalid chapter plan identity, keys or risk flags');

  const context = readChapterContext(vault, bookId, requiredFactKeys, activeThreads);
  const baseline = { bookId, chapter: context.chapter, version: context.version };
  if (chapter !== context.chapter + 1 || parentVersion !== context.version) {
    return { decision: 'STALE_BASELINE', baseline, nextChapter: context.chapter + 1 };
  }
  if (context.missing.length) return { decision: 'MISSING_EVIDENCE', baseline, missing: context.missing };

  const detected = context.dueCount > 0 && !flags.includes('foreshadow_payoff') ? [...flags, 'foreshadow_payoff'] : flags;
  const mode = deep.some((flag) => detected.includes(flag)) ? 'DEEP'
    : standard.some((flag) => detected.includes(flag)) ? 'STANDARD' : 'FAST';
  const beforeDraft = [
    ...(mode === 'DEEP' ? ['novelos-pro-arbiter'] : []),
    ...(flags.includes('creative_difficulty') ? ['novelos-pro-opus'] : []),
    ...(mode !== 'FAST' ? ['novelos-pro-dramaturg'] : []),
  ];
  const requiresReading = mode !== 'FAST' || chapter <= 3 || flags.includes('sample_review');
  const afterDraft = [
    ...(requiresReading ? ['novelos-pro-reader'] : []),
    'novelos-pro-continuity',
  ];
  return {
    decision: 'READY_FOR_HANDOFF', mode, bookId, chapter, parentVersion, risks: detected, requiresReading,
    dispatch: { director: 'novelos-pro-director', beforeDraft, writer: 'novelos-pro-gemini', afterDraft },
    context,
  };
}
