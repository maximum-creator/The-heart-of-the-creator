#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = { files: [], json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--json") args.json = true;
    else args.files.push(argv[i]);
  }
  return args;
}

function maxRun(items, predicate) {
  let best = 0;
  let current = 0;
  for (const item of items) {
    current = predicate(item) ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

export function analyzeProseCadence(text, source = "input") {
  const body = text.replace(/^\s*#{1,6}\s+.*$/gm, "").trim();
  const paragraphs = body
    .split(/\r?\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const paragraphLengths = paragraphs.map((part) => [...part].length);
  const sentenceUnits = body
    .split(/[。！？!?]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const sentenceLengths = sentenceUnits.map((part) => [...part].length);
  const visibleChars = [...body.replace(/\s/g, "")].length;
  const periods = (body.match(/[。！？!?]/g) || []).length;
  const commas = (body.match(/[，、；;]/g) || []).length;
  const dashes = (body.match(/——|—/g) || []).length;
  const colons = (body.match(/：/g) || []).length;
  const ellipses = (body.match(/……|\.\.\./g) || []).length;
  const contrastFrames = (body.match(/不是[^。！？\n]{0,28}而是/g) || []).length;
  const commaChains = body
    .split(/[。！？!?]/)
    .map((unit) => (unit.match(/[，、；;]/g) || []).length);

  const wallRun = maxRun(paragraphLengths, (length) => length > 120);
  const fragmentRun = maxRun(paragraphLengths, (length) => length <= 15);
  const dashParagraphRun = maxRun(paragraphs, (part) => /——|—/.test(part));
  const commaPeriodRatio = periods ? Number((commas / periods).toFixed(2)) : null;
  const dashPerThousand = visibleChars
    ? Number(((dashes / visibleChars) * 1000).toFixed(2))
    : 0;
  const signals = [];

  if (wallRun >= 3) {
    signals.push({ severity: "REVIEW", code: "PARAGRAPH_WALL_RUN", evidence: `${wallRun} consecutive paragraphs exceed 120 characters` });
  }
  if (fragmentRun >= 5) {
    signals.push({ severity: "REVIEW", code: "FRAGMENT_RUN", evidence: `${fragmentRun} consecutive paragraphs are 15 characters or fewer` });
  }
  if (dashes >= 6 && dashPerThousand >= 4) {
    signals.push({ severity: "REVIEW", code: "DASH_DENSITY", evidence: `${dashes} dashes, ${dashPerThousand} per 1000 visible characters` });
  }
  if (dashParagraphRun >= 3) {
    signals.push({ severity: "REVIEW", code: "DASH_PARAGRAPH_RUN", evidence: `${dashParagraphRun} consecutive paragraphs contain dashes` });
  }
  if (periods >= 30 && commaPeriodRatio !== null && commaPeriodRatio < 0.8) {
    signals.push({ severity: "REVIEW", code: "STOP_START_BIAS", evidence: `comma/terminal ratio is ${commaPeriodRatio}` });
  }
  if (Math.max(0, ...commaChains) >= 6) {
    signals.push({ severity: "REVIEW", code: "COMMA_CHAIN", evidence: `one sentence unit contains ${Math.max(...commaChains)} comma-like separators` });
  }
  if (contrastFrames >= 3) {
    signals.push({ severity: "REVIEW", code: "CONTRAST_FRAME_REPEAT", evidence: `${contrastFrames} uses of 不是…而是…` });
  }

  return {
    source,
    note: "Signals locate possible reader-experience problems; they never replace scene-aware human review.",
    visibleChars,
    paragraphs: {
      count: paragraphs.length,
      median: percentile(paragraphLengths, 0.5),
      p90: percentile(paragraphLengths, 0.9),
      max: Math.max(0, ...paragraphLengths),
      over120: paragraphLengths.filter((length) => length > 120).length,
      atMost15: paragraphLengths.filter((length) => length <= 15).length,
      maxWallRun: wallRun,
      maxFragmentRun: fragmentRun
    },
    sentences: {
      count: sentenceUnits.length,
      median: percentile(sentenceLengths, 0.5),
      p90: percentile(sentenceLengths, 0.9)
    },
    punctuation: {
      periods,
      commas,
      commaPeriodRatio,
      dashes,
      dashPerThousand,
      colons,
      ellipses,
      contrastFrames,
      maxCommaChain: Math.max(0, ...commaChains)
    },
    decision: signals.length ? "REVIEW_REQUIRED" : "NO_AUTOMATIC_SIGNAL",
    signals
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  let inputs = [];
  if (args.files.length) {
    inputs = args.files.map((file) => ({ source: file, text: fs.readFileSync(file, "utf8") }));
  } else {
    inputs = [{ source: "stdin", text: fs.readFileSync(0, "utf8") }];
  }

  const results = inputs.map(({ source, text }) => analyzeProseCadence(text, source));
  if (args.json || results.length > 1) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } else {
    const result = results[0];
    process.stdout.write(`${result.decision} ${result.source}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}
