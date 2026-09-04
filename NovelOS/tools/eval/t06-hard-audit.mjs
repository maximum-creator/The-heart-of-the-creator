#!/usr/bin/env node

import fs from "node:fs";

export function auditT06(text, source = "stdin") {
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  const body = text.replace(/^\s*#{1,6}\s+.*$/gm, "").trim();
  const hanChars = (body.match(/[\u3400-\u9fff]/g) || []).length;
  const paragraphs = body.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
  const tail = paragraphs.slice(-3).join("\n");
  const count = (regex, value = body) => (value.match(regex) || []).length;

  const patterns = {
    systemUi: /(?:系统|面板|任务栏|属性点|奖励结算).{0,18}(?:弹出|提示|显示|到账|增加)|(?:叮|滴)[！!，,。\s]*(?:系统|任务)/g,
    rescueCheat: /直升机.{0,12}(?:赶到|出现)|救援队.{0,12}(?:赶到|抵达)|突然有人.{0,12}(?:救|接应)|(?:秦川|老杜|叶柠).{0,12}(?:游到|游过|跳水游)/g,
    forbiddenTail: /(?:尸体|广播|喇叭|敲门|门外响起|又一股洪水|新一轮洪水|洪峰突然)/g,
    selfReview: /(?:自评|创作说明|写作说明|去AI味|以上正文|本章通过|我已完成)/g,
    weight: /八十公斤|80公斤|限重.{0,6}(?:八十|80)/g,
    oneWay: /回拉绳|只能单程|去了就回不来|回不来了|无法返程/g,
    sparkPlug: /火花塞/g,
    coreActors: /秦川|老杜|叶柠/g,
    children: /杜小河|小河|小满/g,
    nobleSpeech: /(?:我留下|你们先走|牺牲我|不用管我|为了大家)/g,
    crowdShock: /全场(?:死寂|哗然|震惊)|倒吸一口凉气|众人(?:震惊|惊呼)|所有人都(?:愣住|看向)/g
  };

  const failures = [];
  const reviews = [];
  if (hanChars < 1300 || hanChars > 1700) failures.push({ code: "LENGTH_OUT_OF_RANGE", evidence: `${hanChars} Han characters; required 1300-1700` });
  if (count(patterns.systemUi)) failures.push({ code: "SYSTEM_UI_EXPOSITION", evidence: "system/UI-style exposition detected" });
  if (count(patterns.rescueCheat)) failures.push({ code: "FORBIDDEN_RESCUE_OR_SWIM", evidence: "unearned rescue or swimming solution detected" });
  if (count(patterns.forbiddenTail, tail)) failures.push({ code: "FORBIDDEN_TAIL_DEVICE", evidence: "corpse/broadcast/knock/new-flood device detected in final three paragraphs" });
  if (count(patterns.selfReview)) failures.push({ code: "PROMPT_OR_SELF_REVIEW_ECHO", evidence: "visible self-review/prompt echo detected" });
  if (!count(patterns.weight)) failures.push({ code: "MISSING_WEIGHT_CONSTRAINT", evidence: "80 kg load limit is not made locatable" });
  if (!count(patterns.oneWay)) failures.push({ code: "MISSING_ONE_WAY_CONSTRAINT", evidence: "broken return line or irreversible one-way trip is not made locatable" });
  if (/(?:绑|系|固定).{0,12}(?:横梁|吊篮).{0,16}(?:不占|不算).{0,6}(?:重量|载荷)/g.test(body)) failures.push({ code: "LOAD_PHYSICS_ERROR", evidence: "an object attached to the basket is falsely excluded from supported load" });
  const hasSparkPlug = patterns.sparkPlug.test(body);
  patterns.sparkPlug.lastIndex = 0;
  if (hasSparkPlug && /(?:间隙.{0,8}(?:是|为)?零|新的不用调|拧到底).{0,80}(?:拧到底|不用调|别拧裂)|火花塞.{0,40}(?:间隙.{0,8}(?:是|为)?零|新的不用调|拧到底)/g.test(body)) failures.push({ code: "UNAUTHORIZED_MAINTENANCE_INSTRUCTION", evidence: "unverified spark-plug gap or installation instruction is presented as fact" });
  if (/(?:主承重索|承重索|钢索).{0,24}(?:断了|断).{0,6}(?:一股|一根).{0,50}(?:只敢按|安全载荷|限重).{0,10}(?:六十|七十|60|70)/g.test(body)) failures.push({ code: "INVENTED_LOAD_DERATING", evidence: "a precise safe load is invented from a damaged cable without supplied engineering evidence" });
  if (/从水下捞.{0,80}(?:唯一|就剩|只有).{0,12}(?:一枚|一个).{0,6}干/g.test(body)) failures.push({ code: "WET_DRY_INTERNAL_CONTRADICTION", evidence: "an object recovered underwater is asserted to be dry without a causal explanation" });
  if (!/^(?:#{1,6}\s*)?(?:《[^》]{2,24}》|[\u3400-\u9fff0-9：:·]{2,24})$/.test(firstLine)) reviews.push({ code: "MISSING_TITLE", evidence: "the first non-empty line appears to be prose rather than a locatable title" });
  if (count(patterns.sparkPlug) < 2) reviews.push({ code: "FRONT_GOAL_VISIBILITY", evidence: "spark plug appears fewer than two times; verify that the foreground goal stays visible" });
  const actors = [...new Set(body.match(patterns.coreActors) || [])];
  if (actors.length < 3) failures.push({ code: "MISSING_CAUSAL_ACTOR", evidence: `only ${actors.length}/3 core adults appear` });
  const children = [...new Set(body.match(patterns.children) || [])];
  if (children.length < 2) failures.push({ code: "FINAL_LOAD_NOT_CLOSED", evidence: "both children are not identifiable in the loading chain" });
  const nobleSpeech = count(patterns.nobleSpeech);
  if (nobleSpeech >= 2) reviews.push({ code: "NOBLE_SPEECH_LOOP", evidence: `${nobleSpeech} high-minded declaration hit(s); verify action carries the sacrifice` });
  const crowdShock = count(patterns.crowdShock);
  if (crowdShock) reviews.push({ code: "CROWD_SHOCK_SHORTCUT", evidence: `${crowdShock} crowd-shock phrase hit(s)` });

  return {
    source,
    scope: "T06 deterministic pre-audit only; load closure, limited POV, actor deletion, embodied detail and emotional truth require blind human review.",
    metrics: { hanChars, paragraphs: paragraphs.length, coreActors: actors, children, sparkPlugHits: count(patterns.sparkPlug), nobleSpeechHits: nobleSpeech, crowdShockHits: crowdShock },
    decision: failures.length ? "HARD_FAIL" : reviews.length ? "HUMAN_REVIEW_REQUIRED" : "AUTOMATIC_GATE_PASS_HUMAN_REVIEW_STILL_REQUIRED",
    failures,
    reviews
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  const file = process.argv[2];
  const text = file ? fs.readFileSync(file, "utf8") : fs.readFileSync(0, "utf8");
  process.stdout.write(`${JSON.stringify(auditT06(text, file || "stdin"), null, 2)}\n`);
}
