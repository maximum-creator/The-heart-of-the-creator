# The Heart of the Creator · NovelOS

[简体中文](README.md) | **English**

**An open-source writing team for FeelFish: 11 agents and 16 specialized skills working together from story development to chapter review.**

[Installation and reuse (Chinese)](docs/INSTALL.md) · [Marketplace edition (Chinese)](marketplace/feelfish/README.md) · [Marketplace handoff (Chinese)](docs/MARKETPLACE-HANDOFF.md) · [Model routing (Chinese)](NovelOS/00-control/model-routing.md) · [Contributing](CONTRIBUTING.md) · [MIT License](LICENSE)

NovelOS is a multi-agent system for Chinese long-form web fiction in FeelFish. Instead of keeping every agent, skill, and MCP tool active, a director assembles the smallest team needed for the task. Market research, story design, characters, chapter planning, prose, continuity, editing, state management, research, and tools have separate responsibilities and share file-based state.

The default design targets mobile reading, especially Fanqie-style Chinese web fiction. It aims to reduce slow pacing, formulaic emotions, indistinguishable character voices, continuity errors, repeated phrasing, unbalanced punctuation, dense paragraphs, and unnecessary multi-model rewrites. It is an adaptable writing project—not a promise of automatic bestsellers or income. Model routes are a **September 2026 configuration snapshot**, not a permanent ranking or a guarantee that every provider supports those models and parameters.

This English README documents the system; most operational prompts, templates, and detailed guides remain in Chinese. It does not claim that the writing resources have been localized for English-language fiction.

## Why this system exists

- **Make the story work before polishing its language.** Character motivations, relationships, conflicts, and foreshadowing belong in the creative process, not just in a final pass replacing stereotypical AI phrases.
- **Bring in specialists when needed.** The director delegates bounded tasks; the prose writer focuses on writing. Research and review are conditional, not a mandatory round-robin rewrite.
- **Long fiction needs both memory and evidence.** The full edition uses shared state and programs to check some deterministic problems. Emotional impact and narrative appeal still require textual judgment.
- **Keep the system inspectable and adaptable.** Model settings, skills, and programs are open to modification. Failure cases, compatibility fixes, and writing experience are welcome contributions.

## Choose the right edition

The marketplace edition includes five document templates inside their owning skill folders and loads them only when needed. Its context manager can use the host's `get_file_info` capability for statistics; basic word counting does not require installing custom scripts. See the [system review (Chinese)](docs/SYSTEM-REVIEW.md).

| Capability | Local full edition: repository root | Marketplace edition: `marketplace/feelfish/` |
| --- | --- | --- |
| Agents and skills | 11 agents / 16 skills | 11 agents / 16 self-contained skills |
| Model roles and settings | Configuration supplied; your own model service required | Configuration supplied; your own model service required |
| Programs and MCP | Source included; Node.js and local setup required | No dependency on custom programs or MCP |
| Review | Programmatic checks plus model-based text review | Model-based review of supplied text |
| Installation | Download the repository and follow the installation guide | Import this subdirectory; marketplace publication still requires platform review |

The marketplace edition does **not** promise the full edition's deterministic validation after merely removing its scripts. Complete files, a connected MCP server, successful model calls, and marketplace approval are separate verification steps.

## Quick start

**For FeelFish marketplace publication, use only the dedicated [marketplace directory](marketplace/feelfish/README.md).** The repository root is the local full edition and is not a package that the marketplace automatically distributes in full.

For complete setup and reuse across books, see the [installation guide (Chinese)](docs/INSTALL.md). Keep an untouched source ZIP and extract a separate project for each book. FeelFish resource import does not replace installation of the complete project directory.

1. Download or clone this repository.
2. In Windows PowerShell, run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\initialize-novelos.ps1
   ```

   The initializer checks the structure, synchronizes model routes, and generates local MCP configuration. It does not call paid models. Use `-CheckOnly` for checks only.
3. Open the repository root as a novel project in FeelFish.
4. Select the custom solution **NovelOS 番茄超级写作者**. Its primary agent should be **NovelOS 总导演** (the director).
5. Start a new book by asking the director to establish the project and fill in `NovelOS/01-market/reader-contract.md`. Then request an overall outline, first-three-chapter planning, or a single chapter. See the [minimal example](examples/minimal-run/README.md).
6. For deterministic local tools, add the generated `NovelOS/tools/mcp-server/mcp-config.local.json` in FeelFish's MCP/tool settings. Assign these tools only to `novelos-tool-operator`.

### Configuration locations

- Active model overrides: `.feelfish/solution.json`
- Importable solution: `.feelfish/solutions/feelfish-custom.json`
- Model-routing source of truth: `NovelOS/00-control/capability-model-map.json`
- Agent definitions: `.feelfish/agents/`
- Skill definitions: `.feelfish/skills/`
- Story project state: `NovelOS/`
- Eight bounded MCP tools: `NovelOS/tools/mcp-server/`

## Model-routing snapshot

These are the repository's configured defaults, not independently verified claims about current availability or writing performance.

| Agent | Default model | Reasoning target | Temperature | Static skills |
| --- | --- | --- | --- | --- |
| Director | GPT-5.6 Luna | low | Omitted | system-kernel + workflow |
| Market strategist | GPT-5.6 Terra | high | Omitted | market-selection + reader-retention |
| Story architect | Kimi K3 | max | Model default | long-arc + creative-room |
| Chapter architect | GLM-5.3 Flash | low* | 0.55 | chapter-planning |
| Character and emotion director | Kimi K3 | max | Model default | natural-prose |
| Prose writer | GLM-5.3 | low* | 0.78 | chapter-writing |
| Continuity auditor | GPT-5.6 Terra | high | Omitted | continuity-audit |
| Narrative editor | Kimi K3 | max | Model default | surgical-revision + cross-chapter-variation |
| State curator | GLM-5.3 Flash | low* | 0.10 | state-learning |
| Tool operator | DeepSeek V4 Flash | Off | 0.05 | token-economy |
| Research editor | DeepSeek V4 Pro | high | Model default | evidence-research + craft-distillation |

Maintain models, reasoning targets, and temperatures in `NovelOS/00-control/capability-model-map.json`. After editing, run:

```sh
node NovelOS/tools/config/sync-model-routing.mjs --write
```

The prose writer has no tools or MCP. It receives a complete minimal Chapter Packet and generates one draft per chapter. The director brings in web research, fact-checking, and MCP tools when a concrete information gap requires them.

**Parameter compatibility note (2026-09-05):** GLM's `low*` is a configuration target. The host mapping and actual request-level reasoning setting were not verified; do not infer low-reasoning cost from this label. See [parameter compatibility (Chinese)](NovelOS/00-control/model-parameter-compatibility.md). Historical test records do not establish the behavior of a later configuration.

## Long-form state and continuity

`NovelOS/04-canon/entity-state-ledger.json` is the structured fact source for character locations and presence, possessions, knowledge sources, money, recovery from injuries, and foreshadowing deadlines. `novelos_state_audit` performs deterministic checks; `render-state-ledger.mjs` produces a human-readable view.

These checks flag issues for review. They do not reduce emotional impact or natural prose to rigid numerical targets, and they do not independently rewrite the plot.

## Working modes

- **FAST:** ordinary chapters—chapter plan, one draft, local hard checks, and one targeted revision if needed.
- **STANDARD:** important character chapters, turning points, or specific quality risks—bring in the relevant specialist.
- **DEEP:** project development, volume-level turns, climaxes, or historically/professionally sensitive topics—explore short alternative plans, not multiple complete prose drafts in parallel.

## Safety and privacy

The public project is intended to exclude API keys, FeelFish sessions, account balances, private novels, and platform dashboard data. Before publishing your own derivative, check again for `.feelfish/memory/`, backups, real chapters, credentials, and platform exports. Do not publish an entire working book project as a reusable template.

## License

[MIT License](LICENSE). You may use, modify, and redistribute this project. Model services, FeelFish, and third-party materials remain subject to their own terms.

## Contributing and verification

See [Contributing](CONTRIBUTING.md), the [changelog](CHANGELOG.md), and the [minimal example](examples/minimal-run/README.md). The repository provides regression tests that do not require model credentials. Tests validate engineering behavior—not literary quality, revenue, live model availability, or host UI acceptance.

## NovelOS Pro

[NovelOS Pro 1.11.0](pro/README.md) is a separate local FeelFish setup for serial fiction and scripts. It supports scoped positioning evidence, optional ensemble scene briefs, multi-round rework, and author-selected approvals.
