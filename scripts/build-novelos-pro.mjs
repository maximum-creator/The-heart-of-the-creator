#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pro = path.join(root, 'pro');
const manifest = JSON.parse(fs.readFileSync(path.join(pro, 'model-routes.json'), 'utf8'));
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const director = 'novelos-pro-director';

export function validateProRoutes(roles) {
  const ids = ['director', 'dramaturg', 'opus', 'gemini', 'reader', 'editor', 'operator', 'continuity', 'curator', 'arbiter'];
  if (Object.keys(roles).length !== ids.length || ids.some((id) => !Object.hasOwn(roles, 'novelos-pro-' + id))) {
    throw new Error('Unexpected role set');
  }
  for (const [id, { model, cap }] of Object.entries(roles)) {
    if (!/^novelos-pro-[a-z]+$/.test(id) || !model?.modelId || !model?.modelName || !Number.isInteger(cap) || cap < 1024) {
      throw new Error('Invalid Pro role ' + id);
    }
    if (!['low', 'medium', 'high'].includes(model.reasoningEffort) || model.enableThinkingMode !== true) {
      throw new Error('Invalid Pro thinking settings: ' + id);
    }
    if (['temperature', 'top_p', 'top_k'].some((key) => Object.hasOwn(model, key))) {
      throw new Error('Pro uses provider sampling defaults: ' + id);
    }
  }
}

export function buildPro(destination) {
  validateProRoutes(manifest.roles);
  const target = path.resolve(destination);
  fs.mkdirSync(target);
  const ff = path.join(target, '.feelfish');
  fs.cpSync(path.join(pro, '.feelfish'), ff, { recursive: true });
  const routing = Object.entries(manifest.roles);
  for (const [id] of routing) {
    const agent = path.join(ff, 'agents', id + '.md');
    let text = fs.readFileSync(agent, 'utf8').replace(/\r\n/g, '\n');
    // FeelFish can advertise a skill without exposing its body to a tool-free agent.
    // Inline the canonical instructions at build time for every constrained role.
    if (/^tools: \[\]$/m.test(text)) {
      const skill = text.match(/^skills: \[([a-z-]+)\]$/m)?.[1];
      if (!skill) throw new Error('Tool-free Pro Agent needs one embedded skill: ' + id);
      const source = fs.readFileSync(path.join(ff, 'skills', skill, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
      text = text.trimEnd() + '\n\n' + source.replace(/^---\n[\s\S]*?\n---\n/u, '').trim() + '\n';
      fs.writeFileSync(agent, text);
    }
  }
  const solution = { version: 1, name: 'NovelOS Pro', primaryAgentId: director,
    description: '卷级策划、单稿创作、独立审计、局部精修和作者批准后的章节交接。',
    agents: routing.map(([id, route]) => ({ id, recommendedModel: route.model })) };
  fs.mkdirSync(path.join(ff, 'solutions'));
  json(path.join(ff, 'solutions', 'feelfish-custom.json'), solution);
  json(path.join(ff, 'solution.json'), { currentSolutionId: 'feelfish-custom',
    agentModels: Object.fromEntries(routing.map(([id, route]) => [id, route.model])) });
  for (const source of ['README.md', 'model-routes.json', 'scene-packet.example.json', 'chapter-handoff.example.json',
    'runtime-observation.example.json', 'canon-candidate.example.json', 'quality-review.example.json']) {
    fs.copyFileSync(path.join(pro, source), path.join(target, source), fs.constants.COPYFILE_EXCL);
  }
  fs.cpSync(path.join(pro, 'templates'), path.join(target, 'templates'), { recursive: true });
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(target, 'LICENSE'), fs.constants.COPYFILE_EXCL);
  for (const source of ['NovelOS/tools/pro/workflow.mjs', 'NovelOS/tools/pro/mcp.mjs', 'NovelOS/tools/pro/dispatch.mjs', 'NovelOS/tools/pro/canon.mjs', 'NovelOS/tools/pro/quality-review.mjs', 'NovelOS/tools/pro/runtime-audit.mjs', 'NovelOS/tools/eval/raw-prose-delivery-audit.mjs']) {
    const to = path.join(target, source);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, source), to, fs.constants.COPYFILE_EXCL);
  }
  for (const name of ['chapters', 'roles', 'outline', 'rules', 'records', 'assets', 'objects', 'inspirations']) {
    fs.mkdirSync(path.join(target, name));
  }
  const file = 'rules/项目约定.md';
  fs.writeFileSync(path.join(target, file), '# NovelOS Pro\n\n草稿只进入当前试写项目，正式设定与作者偏好由作者确认。模型窗口截断保留原始证据，需下一次明确安排才能补写。\n', { flag: 'wx' });
  json(path.join(target, 'feelfish.json'), { projectType: 'novel', rules: [{ relativePath: file }],
    chapters: [], roles: [], outline: [], records: [], assets: [], objects: [], inspirations: [], fileMeta: {}, fileTreeOrder: {} });
  json(path.join(target, 'mcp-config.template.json'), { type: 'stdio', command: 'node',
    args: ['<PRO_ROOT>/NovelOS/tools/pro/mcp.mjs'], cwd: '<PRO_ROOT>',
    env: { NOVELOS_PRO_VAULT: '<EXISTING_PRIVATE_CANON_VAULT>' } });
  return target;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/build-novelos-pro.mjs <new-output-directory>');
  process.stdout.write(buildPro(process.argv[2]) + '\n');
}
