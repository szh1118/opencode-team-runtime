# Team Evidence


## Research source added: Reference skill: karpathy-guidelines SKILL.md

- time: 2026-05-23T08:10:00.751Z
- type: source
- url: /tmp/opencode/reference-study-skills/andrej-karpathy-skills-main/skills/karpathy-guidelines/SKILL.md
- path: .opencode/team/research/chunks/src-175d7098a0.json
- status: recorded


Stored 2 chunks (2506 chars). Source id: src-175d7098a0


## Research source added: Reference skill: write-a-skill SKILL.md

- time: 2026-05-23T08:10:00.774Z
- type: source
- url: /tmp/opencode/reference-study-skills/skills-main/skills/productivity/write-a-skill/SKILL.md
- path: .opencode/team/research/chunks/src-1c26f289b5.json
- status: recorded


Stored 2 chunks (3026 chars). Source id: src-1c26f289b5


## Research source added: Reference skill: setup-matt-pocock-skills SKILL.md

- time: 2026-05-23T08:10:00.797Z
- type: source
- url: /tmp/opencode/reference-study-skills/skills-main/skills/engineering/setup-matt-pocock-skills/SKILL.md
- path: .opencode/team/research/chunks/src-7a8532ff65.json
- status: recorded


Stored 5 chunks (6793 chars). Source id: src-7a8532ff65


## Research source added: Reference skill pack plugin manifest

- time: 2026-05-23T08:10:00.818Z
- type: source
- url: /tmp/opencode/reference-study-skills/skills-main/.claude-plugin/plugin.json
- path: .opencode/team/research/chunks/src-3608999c9f.json
- status: recorded


Stored 1 chunks (614 chars). Source id: src-3608999c9f


## Research claim recorded: claim-e648dcd511

- time: 2026-05-23T08:10:13.753Z
- type: source
- status: recorded


Reference packs use directories containing SKILL.md with YAML front matter; descriptions are treated as the activation surface and should include specific triggers.

Evidence refs: src-1c26f289b5#c0001, src-1c26f289b5#c0002


## Research claim recorded: claim-119fcb8058

- time: 2026-05-23T08:10:13.776Z
- type: source
- status: recorded


The Matt Pocock pack publishes a pack manifest via .claude-plugin/plugin.json listing installable skill directories, while excluding draft/deprecated/personal skills from the promoted manifest per repository rules.

Evidence refs: src-3608999c9f#c0001


## Research claim recorded: claim-838ad04cc1

- time: 2026-05-23T08:10:13.802Z
- type: source
- status: recorded


The setup skill demonstrates progressive disclosure: first install a lightweight activation skill, then scaffold per-repo docs that downstream skills read instead of putting tracker/domain details in every skill prompt.

Evidence refs: src-7a8532ff65#c0001, src-7a8532ff65#c0002, src-7a8532ff65#c0003


## Research claim recorded: claim-800b32bdd3

- time: 2026-05-23T08:10:13.822Z
- type: source
- status: recorded


Karpathy guidelines are a compact always-use coding behavior skill centered on explicit assumptions, simplicity, surgical diffs, and verification loops.

Evidence refs: src-175d7098a0#c0001, src-175d7098a0#c0002


## Research claim validation

- time: 2026-05-23T08:10:22.859Z
- type: review
- status: failed


Validated 4 claims. supported=3, weak=0, unsupported=1.


## Research source added: Reference pack repository rules CLAUDE.md

- time: 2026-05-23T08:10:32.670Z
- type: source
- url: /tmp/opencode/reference-study-skills/skills-main/CLAUDE.md
- path: .opencode/team/research/chunks/src-11fd7ed4ff.json
- status: recorded


Stored 1 chunks (798 chars). Source id: src-11fd7ed4ff


## Research claim recorded: claim-032698372d

- time: 2026-05-23T08:10:32.693Z
- type: source
- status: recorded


The Matt Pocock pack keeps installable skills in .claude-plugin/plugin.json and repository rules say engineering/productivity/misc skills must appear there, while personal, in-progress, and deprecated skills must not.

Evidence refs: src-3608999c9f#c0001


## Research claim recorded: claim-072a01d20a

- time: 2026-05-23T08:10:42.009Z
- type: source
- status: recorded


Matt Pocock pack promotion is controlled by both manifest and repo policy: .claude-plugin/plugin.json lists promoted skill directories, and CLAUDE.md says engineering/productivity/misc skills must be listed while personal/in-progress/deprecated must not.

Evidence refs: src-3608999c9f#c0001, src-11fd7ed4ff#c0001


## Research claim validation

- time: 2026-05-23T08:10:42.033Z
- type: review
- status: failed


Validated 6 claims. supported=4, weak=0, unsupported=2.

