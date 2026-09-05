import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSystemTopology } from '../NovelOS/tools/config/check-system-topology.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const newline of ['\n', '\r\n']) {
  test(`published bindings survive ${JSON.stringify(newline)} line endings and detect missing skills`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novelos-public-'));
    try {
      for (const folder of ['.feelfish', 'NovelOS/00-control']) {
        fs.cpSync(path.join(source, folder), path.join(root, folder), { recursive: true });
      }
      const agents = path.join(root, '.feelfish/agents');
      for (const file of fs.readdirSync(agents)) {
        const target = path.join(agents, file);
        fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace(/\r\n?/g, '\n').replace(/\n/g, newline));
      }
      assert.equal(checkSystemTopology(root).decision, 'PASS');
      fs.unlinkSync(path.join(root, '.feelfish/skills/novelos-chapter-writing/SKILL.md'));
      assert.ok(checkSystemTopology(root).failures.some(f => f.code === 'MISSING_REFERENCED_SKILL'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
