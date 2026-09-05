import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMarketplace } from '../scripts/check-marketplace.mjs';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../marketplace/feelfish');
test('market package is self-contained and model bindings agree',()=>assert.equal(checkMarketplace(source).decision,'PASS'));
test('missing resources, old script dependency and invalid model are detected',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'novelos-market-'));
  try {
    fs.cpSync(source,root,{recursive:true});
    fs.appendFileSync(path.join(root,'.feelfish/agents/novelos-narrative-editor.md'),'\n先运行 NovelOS/tools/eval/narrative-fingerprint.mjs\n');
    fs.unlinkSync(path.join(root,'.feelfish/skills/novelos-cross-chapter-variation/SKILL.md'));
    const file=path.join(root,'.feelfish/solutions/feelfish-custom.json');
    const config=JSON.parse(fs.readFileSync(file,'utf8'));
    config.agents.find(a=>a.id==='novelos-director').recommendedModel.temperature=0.25;
    fs.writeFileSync(file,JSON.stringify(config));
    const codes=checkMarketplace(root).failures.map(f=>f.code);
    for(const code of ['EXTERNAL_DEPENDENCY','UNSUPPORTED_TEMPERATURE','MODEL_DRIFT','PACKAGE_READ_ERROR'])assert.ok(codes.includes(code),code);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
