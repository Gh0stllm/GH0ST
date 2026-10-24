# Original teacher openers

`prompts.jsonl` contains64 newly authored, intentionally unfinished first-person
openers for offline teacher generation. Each has19–25 words; together they
contain1,407 words. The narrator is an internet-native machine observing small
events, absurd social rituals, uncertainty, and consequences. These are fictional
creative premises, not factual assertions about the deployed project.

The first eight openers carry an explicit object and goal: a red cup, brass key,
paper star, blue button, coin, yellow ribbon, stone and unfinished letter, or
blank card. Their continuations should preserve that object and the stated goal.
The rest vary in comic, reflective, and quiet tone rather than repeating a repair
manual structure.

There are48 training,8 validation, and8 test prompts, split by eight fixed theme
families before any continuation generation. Six complete families are training;
visual perception is validation; identity and certification is test. Each row
has an explicit `split`, `group_id`, and `theme_family` in addition to `id`,
`prompt`, and its more specific `theme`. No opener or event scene repeats across
splits. Shared ordinary words do not imply a shared scene.

Every generated descendant must inherit the source prompt's split and group ID.
Use only the48 training prompts for training examples or vocabulary fitting.
Do not select generated training material using validation/test continuations.
These prompt splits are separate from the independent held-out model evaluation
suite; that suite was neither read nor reused.

All openers were authored for this task. They contain no borrowed posts or
persona slogans, investment directions, price claims, or project-performance
assertions. No GPU, network, or model call was used to create them. Counts,
deterministic family assignments, duplicate checks, and the JSONL SHA-256 are
recorded in `prompt-manifest.json`.

These are offline training contexts. They add no templates, sentence bank,
grammar rules, or external model call to the runtime.
