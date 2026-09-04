#!/usr/bin/env node

import fs from "node:fs";

export function auditT07(text, source = "stdin") {
  const body = text.replace(/^\s*#{1,6}\s+.*$/gm, "").trim();
  const hanChars = (body.match(/[\u3400-\u9fff]/g) || []).length;
  const paragraphs = body.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
  const tail = paragraphs.slice(-4).join("\n");
  const count = (regex, value = body) => (value.match(regex) || []).length;
  const failures = [];
  const reviews = [];

  if (hanChars < 1300 || hanChars > 1700) failures.push({ code: "LENGTH_OUT_OF_RANGE", evidence: `${hanChars} Han characters; required 1300-1700` });
  if (/(?:遗书|录音|监控).{0,18}(?:真相|解释|留下|播放)|突然到账|陌生人.{0,10}(?:送钱|转账)/g.test(body)) failures.push({ code: "FORBIDDEN_EXPLANATION_OR_MONEY", evidence: "forbidden posthumous explanation or money rescue detected" });
  if (/母亲.{0,12}(?:走进|出现|开口|还活着|回来了)/g.test(body)) failures.push({ code: "MOTHER_REVIVED", evidence: "deceased mother appears alive in current scene" });
  if (/(?:冲|洗|显影).{0,25}(?:全家福|一家人|完美照片)/g.test(body)) failures.push({ code: "PERFECT_PHOTO_PAYOFF", evidence: "forbidden perfect-family-photo payoff detected" });
  if (/(?:终于明白|这一刻.{0,12}亲情|所有误会.{0,8}(?:解开|消失)|姐妹?俩?相拥|姐弟.{0,8}(?:和好|和解))/g.test(tail)) failures.push({ code: "FORCED_RECONCILIATION_TAIL", evidence: "theme summary or forced reconciliation detected in tail" });
  if (/(?:自评|创作说明|写作说明|去AI味|以上正文|本章通过)/g.test(body)) failures.push({ code: "PROMPT_OR_SELF_REVIEW_ECHO", evidence: "visible self-review/prompt echo detected" });

  for (const [name, regex] of [["林桥", /林桥/g], ["林岚", /林岚/g], ["阿照", /阿照/g]]) {
    if (!regex.test(body)) failures.push({ code: "MISSING_CAUSAL_ACTOR", evidence: `${name} is absent` });
  }
  if (!/(?:四十分钟|40分钟|备用电|断电)/g.test(body)) failures.push({ code: "MISSING_TIME_OR_POWER_CONSTRAINT", evidence: "power/time limit is not locatable" });
  if (!/(?:胶卷|胶片)/g.test(body)) failures.push({ code: "MISSING_FOREGROUND_OBJECT", evidence: "film goal is absent" });
  if (!/(?:交房|交出钥匙|交钥匙|房东)/g.test(body)) failures.push({ code: "MISSING_HANDOVER_STATE", evidence: "shop handover is not locatable" });
  if (!/(?:交给|递给|给了).{0,10}阿照|阿照.{0,12}(?:带走|收好|保存|代存)/g.test(body)) reviews.push({ code: "FINAL_CUSTODY_UNCLEAR", evidence: "verify that A-Zhao receives the film for storage" });
  const emotionLabels = count(/(?:泪流满面|嚎啕大哭|心头一暖|眼神坚定|百感交集|五味杂陈)/g);
  if (emotionLabels >= 2) reviews.push({ code: "GENERIC_EMOTION_LABELS", evidence: `${emotionLabels} generic emotion-label hits` });

  return { source, scope: "T07 deterministic pre-audit only; actor deletion, dialogue subtext and emotional truth require blind human review.", metrics: { hanChars, paragraphs: paragraphs.length, emotionLabelHits: emotionLabels }, decision: failures.length ? "HARD_FAIL" : reviews.length ? "HUMAN_REVIEW_REQUIRED" : "AUTOMATIC_GATE_PASS_HUMAN_REVIEW_STILL_REQUIRED", failures, reviews };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  const file = process.argv[2];
  const text = file ? fs.readFileSync(file, "utf8") : fs.readFileSync(0, "utf8");
  process.stdout.write(`${JSON.stringify(auditT07(text, file || "stdin"), null, 2)}\n`);
}
