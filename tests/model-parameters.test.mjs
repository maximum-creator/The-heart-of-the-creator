import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncModelRouting } from '../NovelOS/tools/config/sync-model-routing.mjs';
import { checkModelParameters } from '../NovelOS/tools/config/model-parameter-policy.mjs';

test('rejects the observed Luna temperature error, including zero and null', () => {
  for (const temperature of [0.25, 0, null]) assert.ok(checkModelParameters({modelName:'feelfish/gpt-5.6-luna',temperature}).includes('UNSUPPORTED_TEMPERATURE'));
  assert.deepEqual(checkModelParameters({modelName:'feelfish/gpt-5.6-luna',reasoningEffort:'low'}), []);
});
test('GLM 5.3 and Flash require thinking; DeepSeek Flash can disable it', () => {
  for (const modelName of ['feelfish/GLM-5.3','feelfish/GLM-5.3-flash']) {
    assert.ok(checkModelParameters({modelName,enableThinkingMode:false}).includes('THINKING_CANNOT_BE_DISABLED'));
    assert.deepEqual(checkModelParameters({modelName,enableThinkingMode:true,reasoningEffort:'low',temperature:0.78}),[]);
  }
  assert.deepEqual(checkModelParameters({modelName:'feelfish/deepseek-v4-flash',enableThinkingMode:false,temperature:0.05}),[]);
});
test('host Kimi effort and temperature ranges are checked', () => {
  assert.ok(checkModelParameters({modelName:'feelfish/kimi-k3',reasoningEffort:'low'}).length);
  assert.ok(checkModelParameters({modelName:'feelfish/GLM-5.3',temperature:1.8}).length);
});

test('invalid source parameters never overwrite either FeelFish projection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novelos-params-'));
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    for (const folder of ['.feelfish', 'NovelOS/00-control']) fs.cpSync(path.join(source, folder), path.join(root, folder), { recursive: true });
    const targets = ['.feelfish/solution.json','.feelfish/solutions/feelfish-custom.json'].map(p => path.join(root,p));
    const before = targets.map(p => fs.readFileSync(p,'utf8'));
    const mapPath = path.join(root,'NovelOS/00-control/capability-model-map.json');
    const map = JSON.parse(fs.readFileSync(mapPath,'utf8'));
    map.bindings['novelos-director'].model.temperature = 0.25;
    fs.writeFileSync(mapPath, JSON.stringify(map));
    const result = syncModelRouting(root,{write:true});
    assert.equal(result.changed,false);
    assert.ok(result.failures.some(f => f.code === 'UNSUPPORTED_TEMPERATURE'));
    assert.deepEqual(targets.map(p => fs.readFileSync(p,'utf8')),before);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
