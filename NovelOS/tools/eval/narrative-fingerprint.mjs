#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CARRIERS = {
  gaze: /目光|眼神|盯着|看向|移开视线/g,
  breath: /呼吸|喘息|吸了口气|吐了口气|气息/g,
  hands: /手指|攥拳|握紧|掌心|指节/g,
  chestThroat: /胸口|心口|喉咙|喉结|嗓子发紧/g,
  silence: /沉默|没说话|没有回答|安静下来/g,
  weatherLight: /雨声|冷风|光线|灯光|阴影|水声/g
};

const TAIL_PATTERNS = [
  { code: "KNOWING_SUMMARY", regex: /(?:他|她|秦川|主角)(?:终于|这才)?(?:知道|明白|清楚)/u },
  { code: "THEME_EXPLANATION", regex: /(?:真正的|原来|这意味着|从这一刻|这一刻起|再也不会|一切才刚刚开始)/u },
  { code: "CLOSING_HANDOFF", regex: /(?:剩下的事|接下来的事|以后(?:的事)?).{0,20}(?:不在|交给|只能靠)/u },
  { code: "CONTRAST_MORAL", regex: /不是.{0,30}而是/u }
];

const REACTION_CAROUSEL = /(?:愣住|一愣|怔住|瞪大(?:了)?眼|倒吸一口凉气|脸色(?:骤然|猛地|微微)?一变|失声(?:道|叫道)?|难以置信|全场(?:死寂|哗然)|认知崩塌)/gu;
const EXPLANATION_ECHO = /(?:这意味着|也就是说|换句话说|显而易见|很显然|(?:他|她)(?:终于|这才)?(?:明白|意识到|知道|清楚))/gu;
const NEGATIVE_PROMPT_ECHO = /(?:没有|并未|不是)[^。！？\n]{0,20}(?:没有|并未|也不是)[^。！？\n]{0,28}(?:只是|而是)/gu;
const CONTRAST_FRAME = /不是[^。！？\n]{0,36}而是/gu;
const SYSTEM_MARKER = /(?:系统|面板|提示音|任务|属性|积分|奖励)/gu;

function matchesWithPosition(text, regex, limit = 6) {
  const matches = [...text.matchAll(regex)];
  return {
    count: matches.length,
    evidence: matches.slice(0, limit).map((match) => ({ index: match.index, text: match[0] }))
  };
}

function hasCluster(matches, size, span) {
  for (let index = 0; index <= matches.length - size; index += 1) {
    if (matches[index + size - 1].index - matches[index].index <= span) return matches.slice(index, index + size);
  }
  return null;
}

function compactHan(text) {
  return (text.match(/[\u3400-\u9fff]/gu) || []).join("");
}

function maximalRepeatedPhrases(text, minLength = 6, maxLength = 14, top = 12) {
  const compact = compactHan(text);
  const occurrences = new Map();
  for (let length = minLength; length <= maxLength; length += 1) {
    for (let index = 0; index <= compact.length - length; index += 1) {
      const phrase = compact.slice(index, index + length);
      if (/^(.)\1+$/u.test(phrase)) continue;
      occurrences.set(phrase, (occurrences.get(phrase) || 0) + 1);
    }
  }
  const candidates = [...occurrences.entries()]
    .filter(([, count]) => count >= 2)
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.phrase.length - a.phrase.length || b.count - a.count || a.phrase.localeCompare(b.phrase, "zh-CN"));
  const kept = [];
  for (const item of candidates) {
    if (kept.some((existing) => existing.phrase.includes(item.phrase) && existing.count === item.count)) continue;
    kept.push(item);
    if (kept.length >= top) break;
  }
  return kept;
}

function crossFileRepeatedPhrases(inputs, minLength = 8, maxLength = 16, top = 12) {
  const occurrences = new Map();
  for (const input of inputs) {
    const compact = compactHan(input.text);
    const seen = new Set();
    for (let length = minLength; length <= maxLength; length += 1) {
      for (let index = 0; index <= compact.length - length; index += 1) {
        const phrase = compact.slice(index, index + length);
        if (/^(.)\1+$/u.test(phrase) || seen.has(phrase)) continue;
        seen.add(phrase);
        if (!occurrences.has(phrase)) occurrences.set(phrase, []);
        occurrences.get(phrase).push(input.source);
      }
    }
  }
  const candidates = [...occurrences.entries()]
    .filter(([, sources]) => new Set(sources).size >= 2)
    .map(([phrase, sources]) => ({ phrase, sources: [...new Set(sources)] }))
    .sort((a, b) => b.phrase.length - a.phrase.length || b.sources.length - a.sources.length || a.phrase.localeCompare(b.phrase, "zh-CN"));
  const kept = [];
  for (const item of candidates) {
    if (kept.some((existing) => existing.phrase.includes(item.phrase) && item.sources.every((source) => existing.sources.includes(source)))) continue;
    kept.push(item);
    if (kept.length >= top) break;
  }
  return kept;
}

function chapterSeamReplays(inputs, windowChars = 800, ngramLength = 4) {
  if (inputs.length < 2) return [];
  const currentHead = compactHan(stripOptionalTitle(inputs[0].text).slice(0, windowChars));
  const currentGrams = new Set();
  for (let index = 0; index <= currentHead.length - ngramLength; index += 1) currentGrams.add(currentHead.slice(index, index + ngramLength));
  if (!currentGrams.size) return [];

  const signals = [];
  for (const previous of inputs.slice(1, 2)) {
    const previousBody = stripOptionalTitle(previous.text);
    const previousTail = compactHan(previousBody.slice(-windowChars));
    const previousGrams = new Set();
    for (let index = 0; index <= previousTail.length - ngramLength; index += 1) previousGrams.add(previousTail.slice(index, index + ngramLength));
    const shared = [...currentGrams].filter((phrase) => previousGrams.has(phrase));
    const headContainment = shared.length / currentGrams.size;
    if (shared.length >= 6 && headContainment >= 0.02) {
      signals.push({
        current: inputs[0].source,
        previous: previous.source,
        ngramLength,
        sharedCount: shared.length,
        headContainment: Number(headContainment.toFixed(3)),
        evidence: shared.slice(0, 12)
      });
    }
  }
  return signals;
}

function stripOptionalTitle(text) {
  const normalized = String(text ?? "").replace(/^\uFEFF/u, "").replace(/\r\n?/g, "\n").trim();
  const parts = normalized.split(/\n\s*\n/u);
  const first = parts[0]?.trim() || "";
  const title = /^(?:#{1,6}\s*)?(?:《[^》]{1,30}》|[\u3400-\u9fff0-9：:·]{1,30})$/u.test(first);
  return title && parts.length > 1 ? parts.slice(1).join("\n\n").trim() : normalized.replace(/^\s*#{1,6}\s+.*$/gmu, "").trim();
}

function classifyOpening(text) {
  const firstParagraph = (text.split(/\n\s*\n/u).find((item) => item.trim()) || "").trim().slice(0, 180);
  const firstSentence = (firstParagraph.split(/[。！？!?]/u)[0] || firstParagraph).slice(0, 100);
  if (/^[“「]/u.test(firstParagraph)) return "dialogue";
  if (/系统|面板|提示|任务|奖励/u.test(firstSentence)) return "system";
  if (/醒来|睁开眼|重生|前世/u.test(firstSentence)) return "awakening-or-rebirth";
  if (/冲|砸|撞|扑|抓|拽|跑|追|踹|滚/u.test(firstSentence)) return "physical-action";
  if (/雨|风|雪|水|天色|夜色|阳光|灯光|雾/u.test(firstSentence)) return "environment";
  return "other";
}

function classifyEnding(text) {
  const tail = text.slice(-320);
  const summaries = TAIL_PATTERNS.filter((item) => item.regex.test(tail)).map((item) => item.code);
  if (summaries.length) return { kind: "summary-or-theme", summaries };
  if (/系统|面板|提示|任务|奖励/u.test(tail)) return { kind: "system", summaries: [] };
  if (/敲门|门外|电话|广播|尸体|黑影|脚步声/u.test(tail)) return { kind: "external-device", summaries: [] };
  if (/[”」]\s*$/u.test(tail.trim())) return { kind: "dialogue", summaries: [] };
  if (/冲|砸|撞|扑|抓|拽|跑|追|启动|落下|断开/u.test(tail)) return { kind: "ongoing-action-or-consequence", summaries: [] };
  return { kind: "other", summaries: [] };
}

function analyzeOne(text, source) {
  const body = stripOptionalTitle(text);
  const carriers = Object.fromEntries(Object.entries(CARRIERS).map(([name, regex]) => [name, (body.match(regex) || []).length]));
  const sortedCarriers = Object.entries(carriers).sort((a, b) => b[1] - a[1]);
  const ending = classifyEnding(body);
  const repeatedPhrases = maximalRepeatedPhrases(body);
  const signals = [];
  const reactions = [...body.matchAll(REACTION_CAROUSEL)].map((match) => ({ index: match.index, text: match[0] }));
  const reactionCluster = hasCluster(reactions, 4, 600);
  const explanationEcho = matchesWithPosition(body, EXPLANATION_ECHO);
  const negativeEcho = matchesWithPosition(body, NEGATIVE_PROMPT_ECHO);
  const contrastFrames = matchesWithPosition(body, CONTRAST_FRAME);
  const systemMarkers = matchesWithPosition(body, SYSTEM_MARKER);
  if (ending.kind === "summary-or-theme") signals.push({ code: "TAIL_SUMMARY_OR_THEME", evidence: ending.summaries });
  if (repeatedPhrases.some((item) => item.phrase.length >= 8 && item.count >= 2)) signals.push({ code: "INTERNAL_EXACT_PHRASE_REPEAT", evidence: repeatedPhrases.filter((item) => item.phrase.length >= 8).slice(0, 6) });
  if (sortedCarriers[0]?.[1] >= 5 && sortedCarriers[0][1] >= Math.max(2, (sortedCarriers[1]?.[1] || 0) * 2)) signals.push({ code: "DOMINANT_EMOTION_CARRIER", evidence: { carrier: sortedCarriers[0][0], hits: sortedCarriers[0][1] } });
  if (reactionCluster) signals.push({ code: "REACTION_CAROUSEL", evidence: reactionCluster });
  if (explanationEcho.count >= 3) signals.push({ code: "EXPLANATION_ECHO_CHAIN", evidence: explanationEcho.evidence });
  if (negativeEcho.count >= 2) signals.push({ code: "NEGATIVE_PROMPT_ECHO_CHAIN", evidence: negativeEcho.evidence });
  if (contrastFrames.count >= 3) signals.push({ code: "REPEATED_CONTRAST_FRAME", evidence: contrastFrames.evidence });
  if (systemMarkers.count >= 4 && reactions.length >= 4) signals.push({ code: "SYSTEM_REACTION_REWARD_LOOP", evidence: { systemMarkers: systemMarkers.evidence.slice(0, 4), reactions: reactions.slice(0, 4) } });
  return { source, opening: classifyOpening(body), ending, carriers, repeatedPhrases, trajectoryCounts: { reactions: reactions.length, explanationEcho: explanationEcho.count, negativeEcho: negativeEcho.count, contrastFrames: contrastFrames.count, systemMarkers: systemMarkers.count }, signals };
}

export function analyzeNarrativeFingerprints(inputs) {
  if (!Array.isArray(inputs) || !inputs.length) throw new Error("at least one input is required");
  const files = inputs.map((item) => analyzeOne(item.text, item.source));
  const collectionSignals = [];
  const crossFilePhrases = inputs.length >= 2 ? crossFileRepeatedPhrases(inputs) : [];
  const seamReplays = chapterSeamReplays(inputs);
  if (crossFilePhrases.length) collectionSignals.push({ code: "CROSS_FILE_EXACT_PHRASE_REPEAT", evidence: crossFilePhrases });
  if (seamReplays.length) collectionSignals.push({ code: "CHAPTER_SEAM_REPLAY", evidence: seamReplays });
  if (files.length >= 3) {
    const openingCounts = new Map();
    const endingCounts = new Map();
    for (const file of files) {
      openingCounts.set(file.opening, (openingCounts.get(file.opening) || 0) + 1);
      endingCounts.set(file.ending.kind, (endingCounts.get(file.ending.kind) || 0) + 1);
    }
    for (const [kind, count] of openingCounts) if (kind !== "other" && count >= 3) collectionSignals.push({ code: "OPENING_MODE_REPEAT", evidence: { kind, count } });
    for (const [kind, count] of endingCounts) if (kind !== "other" && count >= 3) collectionSignals.push({ code: "ENDING_MODE_REPEAT", evidence: { kind, count } });

    for (const carrier of Object.keys(CARRIERS)) {
      const dominantIn = files.filter((file) => {
        const sorted = Object.entries(file.carriers).sort((a, b) => b[1] - a[1]);
        return sorted[0]?.[0] === carrier && sorted[0][1] >= 2;
      }).length;
      if (dominantIn >= 3) collectionSignals.push({ code: "SHARED_DOMINANT_CARRIER", evidence: { carrier, files: dominantIn } });
    }
  }
  return {
    note: "Fingerprints are retrieval signals, not style scores. Intentional refrain, character catchphrase and thematic return may be retained with a stated purpose.",
    files,
    crossFilePhrases,
    seamReplays,
    collectionSignals,
    decision: files.some((file) => file.signals.length) || collectionSignals.length ? "HUMAN_REVIEW_REQUIRED" : "NO_AUTOMATIC_SIGNAL"
  };
}

function parseArgs(argv) {
  const files = [];
  for (const value of argv) if (value !== "--json") files.push(value);
  if (!files.length) throw new Error("usage: narrative-fingerprint.mjs [--json] <current> [recent files ...]");
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const files = parseArgs(process.argv.slice(2));
  const result = analyzeNarrativeFingerprints(files.map((file) => ({ source: file, text: fs.readFileSync(file, "utf8") })));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
