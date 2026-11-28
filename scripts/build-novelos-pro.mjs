#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pro = path.join(root, 'pro');
const manifest = JSON.parse(fs.readFileSync(path.join(pro, 'model-routes.json'), 'utf8'));
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const director = 'novelos-pro-director';

export function loadProBindings(source, roles) {
  const skills = path.join(source, 'skills');
  const available = new Set(fs.readdirSync(skills, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  const used = new Set();
  const bindings = new Map();
  for (const id of Object.keys(roles)) {
    const agent = fs.readFileSync(path.join(source, 'agents', id + '.md'), 'utf8').replace(/\r\n/g, '\n');
    const metadata = agent.match(/^---\n([\s\S]*?)\n---\n/u)?.[1] ?? '';
    const list = (key) => metadata.match(new RegExp('^' + key + ': \\[([^\\]]*)\\]$', 'm'))?.[1]
      .split(',').map((item) => item.trim()).filter(Boolean);
    const tools = list('tools');
    const selected = list('skills');
    if (!tools || !selected?.length || selected.length > 2 || new Set(selected).size !== selected.length
      || tools.includes('all') || selected.some((skill) => !available.has(skill))) throw new Error('Invalid Pro bindings: ' + id);
    if (id !== 'novelos-pro-operator' && tools.some((tool) => tool.startsWith('novelos_pro_'))) {
      throw new Error('Pro MCP is restricted to the tool operator: ' + id);
    }
    if (!tools.includes('read_file_content') && selected.length !== 1) throw new Error('Inline exactly one Pro skill: ' + id);
    const definitions = selected.map((skill) => {
      used.add(skill);
      const definition = fs.readFileSync(path.join(skills, skill, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
      const frontmatter = definition.match(/^---\n([\s\S]*?)\n---\n/u);
      if (!frontmatter?.[1].split('\n').includes('name: ' + skill) || !definition.slice(frontmatter[0].length).trim()) {
        throw new Error('Invalid Pro skill definition: ' + skill);
      }
      return definition.slice(frontmatter[0].length).trim();
    });
    bindings.set(id, { agent, tools, skills: selected, definitions });
  }
  const orphaned = [...available].filter((skill) => !used.has(skill));
  if (orphaned.length) throw new Error('Unassigned Pro skills: ' + orphaned.join(', '));
  return bindings;
}

export function validateProRoutes(roles) {
  const ids = ['director', 'dramaturg', 'opus', 'gemini', 'reader', 'editor', 'operator', 'continuity', 'curator', 'arbiter'];
  if (Object.keys(roles).length !== ids.length || ids.some((id) => !Object.hasOwn(roles, 'novelos-pro-' + id))) {
    throw new Error('Unexpected role set');
  }
  const effortLevels = ['low', 'medium', 'high'];
  for (const [id, { model, cap, effortByMode }] of Object.entries(roles)) {
    if (!/^novelos-pro-[a-z]+$/.test(id) || !model?.modelId || !model?.modelName || !Number.isInteger(cap) || cap < 1024) {
      throw new Error('Invalid Pro role ' + id);
    }
    if (model.modelId !== 'feelfish' || !model.modelName.startsWith('feelfish/') || model.modelName.startsWith('feelfish/gemini-3')) {
      throw new Error('Pro requires a FeelFish Cloud route and Gemini 4 for Gemini roles: ' + id);
    }
    if (!effortLevels.includes(model.reasoningEffort) || model.enableThinkingMode !== true
      || (effortByMode && Object.entries(effortByMode).some(([mode, effort]) =>
        !['FAST', 'STANDARD', 'DEEP'].includes(mode) || !effortLevels.includes(effort)))) {
      throw new Error('Invalid Pro thinking settings: ' + id);
    }
    if (['temperature', 'top_p', 'top_k', 'topP', 'topK'].some((key) => Object.hasOwn(model, key))) {
      throw new Error('Pro uses provider sampling defaults: ' + id);
    }
  }
}

export function buildPro(destination) {
  validateProRoutes(manifest.roles);
  const source = path.join(pro, '.feelfish');
  const bindings = loadProBindings(source, manifest.roles);
  const target = path.resolve(destination);
  fs.mkdirSync(target);
  const ff = path.join(target, '.feelfish');
  fs.cpSync(source, ff, { recursive: true });
  const routing = Object.entries(manifest.roles);
  for (const [id, { agent, tools, definitions }] of bindings) {
    // Embed the only skill where the role cannot read a project file.
    if (!tools.includes('read_file_content')) {
      fs.writeFileSync(path.join(ff, 'agents', id + '.md'), agent.trimEnd() + '\n\n' + definitions[0] + '\n');
    }
  }
  const solution = { version: 1, name: 'NovelOS Pro ' + manifest.version, primaryAgentId: director,
    description: '卷级策划、单稿创作、独立审计、局部精修和作者批准后的章节交接。',
    agents: routing.map(([id, route]) => ({ id, recommendedModel: route.model })) };
  fs.mkdirSync(path.join(ff, 'solutions'));
  json(path.join(ff, 'solutions', 'feelfish-custom.json'), solution);
  json(path.join(ff, 'solution.json'), { currentSolutionId: 'feelfish-custom',
    agentModels: Object.fromEntries(routing.map(([id, route]) => [id, route.model])) });
  for (const source of ['README.md', 'model-routes.json', 'scene-packet.example.json', 'chapter-handoff.example.json',
    'runtime-observation.example.json', 'canon-candidate.example.json', 'quality-review.example.json', 'MARKETPLACE.md']) {
    fs.copyFileSync(path.join(pro, source), path.join(target, source), fs.constants.COPYFILE_EXCL);
  }
  fs.cpSync(path.join(pro, 'templates'), path.join(target, 'templates'), { recursive: true });
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(target, 'LICENSE'), fs.constants.COPYFILE_EXCL);
  for (const source of ['NovelOS/tools/pro/workflow.mjs', 'NovelOS/tools/pro/mcp.mjs', 'NovelOS/tools/pro/dispatch.mjs', 'NovelOS/tools/pro/canon.mjs', 'NovelOS/tools/pro/quality-review.mjs', 'NovelOS/tools/pro/runtime-audit.mjs', 'NovelOS/tools/pro/work-readiness.mjs', 'NovelOS/tools/pro/rework.mjs', 'NovelOS/tools/pro/story-prep.mjs', 'NovelOS/tools/eval/raw-prose-delivery-audit.mjs']) {
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
