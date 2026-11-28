import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { assessPositioning } from './story-prep.mjs';

const hash = (data) => createHash('sha256').update(data).digest('hex');
const text = (value, max = 500) => typeof value === 'string' && Boolean(value.trim()) && value.length <= max;
function located(artifact, quote) {
  if (!text(quote, 320) || quote.trim().length < 4) return false;
  const start = artifact.indexOf(quote);
  return start >= 0 && artifact.indexOf(quote, start + 1) < 0;
}
const whole = (value, min) => Number.isSafeInteger(value) && value >= min;
const phases = ['SETUP', 'CHOICE', 'PAYOFF', 'HANDOFF'];
const marketKinds = ['HYPOTHESIS', 'COMPARABLE', 'PLATFORM_DATA', 'TARGET_INTERVIEW'];

export const workProfiles = {
  NOVEL: {
    unit: '章节', audience: 'TARGET_READERS',
    checks: ['character_voice', 'causal_progress', 'reader_payoff', 'cross_chapter_continuity'],
    delivery: '章名、正文、章末推进。人物声线、视角和卷内兑现随章包交接。',
  },
  VERTICAL_DRAMA: {
    unit: '分集', audience: 'TARGET_VIEWERS', production: 'TABLE_READ', requiresMaxSeconds: true,
    checks: ['screen_action', 'episode_payoff', 'dialogue_playability', 'production_feasibility'],
    delivery: '分集目标、场次号、内外景、时间地点、动作与台词、预计时长、集间承接和制作风险。',
  },
  LONG_DRAMA: {
    unit: '集或场组', audience: 'TARGET_VIEWERS', production: 'TABLE_READ',
    checks: ['screen_action', 'scene_turn', 'subplot_continuity', 'production_feasibility'],
    delivery: '集与场次、内外景与时间地点、动作台词、主支线变化、布景及表演需求。',
  },
  COMIC_DRAMA: {
    unit: '分镜段或集', audience: 'TARGET_VIEWERS', production: 'STORYBOARD_REVIEW',
    checks: ['visual_readability', 'panel_progression', 'voice_image_split', 'asset_feasibility'],
    delivery: '镜头或格号、可见动作、对白和音效、人物与场景资产、镜头衔接和复用说明。',
  },
};

function validateAudience(audience) {
  const missing = ['platform', 'segment', 'promise'].filter((key) => !text(audience?.[key]))
    .map((key) => 'story.audience.' + key);
  const evidence = audience?.evidence;
  if (!Array.isArray(evidence) || evidence.length > 10 || !evidence.every((item) =>
    marketKinds.includes(item?.kind) && text(item.source, 300) && text(item.observation))) missing.push('story.audience.evidence');
  return missing;
}

function validatePlan(story, unit, profile) {
  const gaps = [];
  const need = (ok, path) => { if (!ok) gaps.push(path); };
  for (const key of ['workId', 'premise', 'continuationEngine']) need(text(story?.[key]), 'story.' + key);
  gaps.push(...validateAudience(story?.audience));
  const beats = story?.beats;
  need(Array.isArray(beats) && beats.length === phases.length, 'story.beats');
  let previous = 0;
  for (const [i, phase] of phases.entries()) {
    const beat = Array.isArray(beats) ? beats[i] : undefined;
    need(beat?.phase === phase && whole(beat?.position, 1) && beat.position > previous, 'story.beats.' + phase + '.position');
    if (whole(beat?.position, 1)) previous = beat.position;
    for (const key of ['sourceRef', 'change']) need(text(beat?.[key]), 'story.beats.' + phase + '.' + key);
    if (i > 0) need(text(beat?.because), 'story.beats.' + phase + '.because');
    if (phase === 'CHOICE') {
      need(text(beat?.choice), 'story.beats.CHOICE.choice');
      need(text(beat?.cost), 'story.beats.CHOICE.cost');
    }
    if (phase === 'HANDOFF') need(text(beat?.openQuestion), 'story.beats.HANDOFF.openQuestion');
  }
  for (const key of ['id', 'objective', 'change']) need(text(unit?.[key]), 'unit.' + key);
  const risks = unit?.risks;
  need(Array.isArray(risks) && new Set(risks).size === risks.length && risks.every((risk) =>
    ['creative_difficulty', 'cross_unit_conflict', 'payoff', 'sample_review', 'scene_design'].includes(risk)), 'unit.risks');
  if (profile.production) need(text(unit?.productionLimit), 'unit.productionLimit');
  if (profile.requiresMaxSeconds || unit?.maxSeconds !== undefined) {
    need(whole(unit?.maxSeconds, 1), 'unit.maxSeconds');
  }
  const criteria = unit?.acceptance;
  need(criteria && whole(criteria.minParticipants, 1) && typeof criteria.minContinueRate === 'number'
    && criteria.minContinueRate > 0 && criteria.minContinueRate <= 1 && whole(criteria.maxReworkMinutes, 0), 'unit.acceptance');
  return gaps;
}

function schedule(risks) {
  const deep = risks.includes('cross_unit_conflict');
  const needsSceneDesign = deep || risks.includes('payoff') || risks.includes('scene_design');
  const needsCreativeSupport = risks.includes('creative_difficulty');
  return {
    director: 'novelos-pro-director', tools: 'LOCAL_MCP', writer: 'novelos-pro-gemini',
    beforeDraft: [
      ...(deep ? ['novelos-pro-arbiter'] : []),
      ...(needsCreativeSupport ? ['novelos-pro-opus'] : []),
      ...(needsSceneDesign ? ['novelos-pro-dramaturg'] : []),
    ],
    afterDraft: [
      ...(needsSceneDesign || needsCreativeSupport || risks.includes('sample_review') ? ['novelos-pro-reader'] : []),
      'novelos-pro-continuity', 'novelos-pro-curator',
    ],
    localEdit: 'novelos-pro-editor', approval: 'AUTHOR',
  };
}

export function evaluateWorkReadiness(input = {}) {
  const { format, phase, story, unit, review, artifact } = input;
  const profile = Object.hasOwn(workProfiles, format) ? workProfiles[format] : null;
  if (!profile) return { decision: 'UNKNOWN_FORMAT', supportedFormats: Object.keys(workProfiles) };
  if (phase !== undefined && phase !== 'POSITIONING') return { decision: 'UNKNOWN_PHASE', format };
  if (phase === 'POSITIONING') {
    const missing = validateAudience(story?.audience);
    if (missing.length) return { decision: 'RETURN_TO_DEVELOPMENT', format, missing, owner: 'novelos-pro-director' };
    const evidence = assessPositioning(story.audience, story.positioning);
    if (evidence.missing || story.positioning === undefined) return { decision: 'RETURN_TO_DEVELOPMENT', format,
      missing: evidence.missing?.map((key) => 'story.positioning.' + key) ?? ['story.positioning'], owner: 'novelos-pro-director' };
    return { decision: 'POSITIONING_REVIEW', format, owner: 'novelos-pro-director', marketBasis: evidence.basis,
      positioning: story.positioning, positioningEvidence: evidence };
  }
  const missing = validatePlan(story, unit, profile);
  if (missing.length) return { decision: 'RETURN_TO_DEVELOPMENT', format, missing, owner: 'novelos-pro-director' };
  const positioning = assessPositioning(story.audience, story.positioning);
  if (positioning.missing) return { decision: 'RETURN_TO_DEVELOPMENT', format,
    missing: positioning.missing.map((key) => 'story.positioning.' + key), owner: 'novelos-pro-director' };

  const storyPlanSha256 = hash(JSON.stringify(story));
  const workPlanSha256 = hash(JSON.stringify({ format, storyPlanSha256, unit }));
  const result = {
    format, storyPlanSha256, workPlanSha256,
    order: { format, unit, audience: { segment: story.audience.segment, promise: story.audience.promise },
      delivery: profile.delivery, reviewChecks: profile.checks, dispatch: schedule(unit.risks) },
    marketBasis: positioning.basis, positioningEvidence: positioning,
  };
  if (!review) return { decision: 'READY_TO_PLAN_DRAFT', ...result };
  if (!['OFFLINE_FIXTURE', 'LIVE_REVIEW'].includes(review.scope)) return { decision: 'REVIEW_INCOMPLETE', ...result, missing: ['review.scope'] };
  if (!text(artifact, 250000)) return { decision: 'REVIEW_INCOMPLETE', ...result, missing: ['artifact'] };
  const artifactSha256 = hash(artifact);
  const bound = { ...result, artifactSha256 };
  if (review.workPlanSha256 !== workPlanSha256 || review.artifactSha256 !== artifactSha256) {
    return { decision: 'STALE_REVIEW', ...bound };
  }

  const checks = Array.isArray(review.checks) ? review.checks : [];
  const byCheck = new Map(checks.map((item) => [item?.id, item]));
  const missingChecks = profile.checks.filter((id) => {
    const item = byCheck.get(id);
    return !item || !['PASS', 'AUTHOR_REVIEW', 'BLOCK'].includes(item.decision)
      || !text(item.note) || !located(artifact, item.quote);
  });
  if (missingChecks.length || checks.length !== profile.checks.length || byCheck.size !== checks.length) {
    return { decision: 'REVIEW_INCOMPLETE', ...bound, missing: missingChecks.length ? missingChecks : ['review.checks'] };
  }
  const blockers = checks.filter((item) => item.decision === 'BLOCK');
  const authorNotes = checks.filter((item) => item.decision === 'AUTHOR_REVIEW');
  if (blockers.length) return { decision: 'RETURN_FOR_REVISION', ...bound, blockers, authorNotes };
  let estimatedSeconds;
  if (profile.production) {
    const scenes = review.scenes;
    if (!Array.isArray(scenes) || !scenes.length || scenes.length > 200
      || new Set(scenes.map((scene) => scene?.id)).size !== scenes.length
      || scenes.some((scene) => !text(scene?.id, 80) || !text(scene.place) || !text(scene.time)
        || !located(artifact, scene.actionQuote)
        || !whole(scene.estimatedSeconds, 1) || !Array.isArray(scene.assets)
        || scene.assets.length > 40 || scene.assets.some((asset) => !text(asset, 160)))) {
      return { decision: 'REVIEW_INCOMPLETE', ...bound, missing: ['review.scenes'], authorNotes };
    }
    estimatedSeconds = scenes.reduce((sum, scene) => sum + scene.estimatedSeconds, 0);
    if (!Number.isSafeInteger(estimatedSeconds) || (unit.maxSeconds !== undefined && estimatedSeconds > unit.maxSeconds)) {
      return { decision: 'RETURN_FOR_REVISION', ...bound, blockers: ['SCENE_RUNTIME_EXCEEDS_PLAN'], estimatedSeconds, authorNotes };
    }
  }
  const productionSummary = estimatedSeconds === undefined ? {} : { estimatedSeconds };
  if (review.scope === 'OFFLINE_FIXTURE') return { decision: 'OFFLINE_ONLY', ...bound, ...productionSummary, authorNotes };

  const { audience, production, author } = review;
  const acceptance = unit.acceptance;
  const pending = [];
  if (!audience || audience.kind !== profile.audience || !text(audience.sourceRef)
    || !whole(audience.participants, 1) || !whole(audience.wantContinue, 0) || audience.wantContinue > audience.participants) {
    pending.push('actual_target_audience_feedback');
  }
  if (profile.production && (production?.kind !== profile.production || !text(production.sourceRef)
    || !['PASS', 'BLOCK'].includes(production.decision) || !text(production.note))) pending.push('production_review');
  if (!whole(review.authorReworkMinutes, 0)) pending.push('actual_author_rework');
  if (pending.length) return { decision: 'LIVE_EVIDENCE_REQUIRED', ...bound, ...productionSummary, pending, authorNotes };
  if ((profile.production && production.decision === 'BLOCK') || audience.participants < acceptance.minParticipants
    || audience.wantContinue / audience.participants < acceptance.minContinueRate || review.authorReworkMinutes > acceptance.maxReworkMinutes) {
    return { decision: 'PROJECT_CRITERIA_NOT_MET', ...bound, ...productionSummary, authorNotes };
  }

  const reviewSha256 = hash(JSON.stringify({ workPlanSha256, artifactSha256, checks, audience, production, scenes: review.scenes,
    acceptance, authorReworkMinutes: review.authorReworkMinutes }));
  const accepted = author?.decision === 'APPROVE' && text(author.sourceRef) && author.reviewSha256 === reviewSha256
    && (!authorNotes.length || author.notesReviewed === true);
  return { decision: accepted ? 'AUTHOR_APPROVAL_RECORDED' : 'AUTHOR_REVIEW_REQUIRED',
    ...bound, ...productionSummary, reviewSha256, authorNotes };
}

if (process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url) {
  const [inputFile, artifactFile] = process.argv.slice(2);
  if (!inputFile) throw new Error('Usage: node work-readiness.mjs <assessment.json> [artifact.txt]');
  const input = JSON.parse(fs.readFileSync(inputFile, 'utf8').replace(/^\uFEFF/u, ''));
  if (artifactFile) input.artifact = fs.readFileSync(artifactFile, 'utf8');
  console.log(JSON.stringify(evaluateWorkReadiness(input), null, 2));
}
