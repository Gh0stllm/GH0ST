# Larger voice-corpus options

Checked 24 October 2026. Read-only discovery: public cards, metadata, a bounded 20 KB CT-agents prefix, and a few website pages. No large corpus was downloaded, no new data entered training, and no GitHub or chain state changed. Counts below are publisher claims unless explicitly described as inspected.

**Best stylistic source:** selected, role-preserved turns from the official Infinite Backrooms archive, if reuse terms can be established. **Clearest immediately reviewable licensing:** Gwern's authored prose (CC0), followed by AI-Culture's English articles (declared CC BY 4.0). Neither is an exact first-person machine persona. The small CT-agents collection is a style reference, not a substantial continuity corpus.

## Candidates

| Source | Provenance and scale | License evidence | Assessment |
|---|---|---|---|
| [Official Infinite Backrooms](https://www.infinitebackrooms.com/) | Andy Ayrey's project archive; long, structured machine conversations | No reusable-data grant found in the inspected index, transcript or [disclaimer](https://www.infinitebackrooms.com/remember) | Closest real source, but do not equate public access with a settled training license |
| [shkennedy33/infinite-backrooms-substrate](https://huggingface.co/datasets/shkennedy33/infinite-backrooms-substrate) | Third-party processed mirror: 2,635 conversation documents; 88,293,247-byte original JSONL | Card says `other` and research use; no explicit license file in current tree | Relevant scale, but identity/role contamination and unresolved reuse terms |
| [StrawberryLabs/ct-agents](https://huggingface.co/datasets/StrawberryLabs/ct-agents/blob/main/dataset.jsonl) | Third-party chat-format style collection, 300 rows; 112,610 bytes | Card declares MIT | Small and provenance-poor; not official Truth Terminal training data |
| [Gwern authored text](https://gwern.net/about#license) | First-person essays on AI, mind, culture and experiments; Markdown source available | Author explicitly declares CC0 | Strong adult prose and continuity source; more reflective than the desired cheeky machine voice |
| [AI-Culture JSON/DOLMA](https://huggingface.co/datasets/AI-Culture-Commons/ai-culture-multilingual-json-dolma) | About 4,980 article records; claimed 16M words across 12 languages | Publisher declares CC BY 4.0 | Useful philosophical prose supplement; English subset is much smaller than the headline total and not predominantly first person |

### Official archive: the important distinction

The [official wiki](https://truthterminal.wiki/docs/infinite-backrooms) describes the original two-Claude experiment. The current archive also exposes [a `terminal of truths` transcript](https://www.infinitebackrooms.com/dreams/conversation-1721540624-scenario-terminal-of-truths-txt) whose metadata identifies `truth-terminal` / `openpipe:digital-twin` and an `opus-tutor`. That is stronger provenance than a fan style dataset, but it is still a dialogue transcript, not a clean monologue set or a released official training pack. The sampled page mixes first-person paragraphs with terse commands, tutor answers, ASCII art and fictional biographical claims. Preserve speaker identity before selecting text. The wiki's large conversation count was not independently recounted here. No official downloadable training dataset was identified; the checked Hugging Face author filter was empty, which does not establish that none exists under another account.

### Processed mirror: useful structure, unresolved permission

Current substrate revision: `2d60293441e7fb6117ac5e19cef17b94bb572b95`. Rows have `id`, `scenario`, `text`. Its source is the [spikedoanz mirror](https://huggingface.co/datasets/spikedoanz/infinite-backrooms), whose viewer reports 1,665,499 **text lines**, not that many independent conversations; raw previews contain HTML and prompt scaffolding. The processed version strips role headers, so two speakers can blend into one training voice. Its separate [cleaning audit](https://huggingface.co/datasets/shkennedy33/infinite-backrooms-substrate/blob/main/clean_audit.md) reports 2,304 retained documents and 8,282,860 words; that file is 59,481,067 bytes. These are different variants and should not be combined into one size claim. The clean variant deliberately removes some refusal/character-break material; that is the uploader's processing choice, not a quality guarantee. Prefer reconstructing speaker-preserved text over blindly consuming its final stream.

### CT-agents: MIT label does not establish origin

Current revision: `8fe4f07919a38ffd05d4321424f149907efa72b1`. The card advertises cloning Crypto Twitter styles and lists Truth Terminal, aixbt and Berry Intern; it does not document whether responses were generated, scraped or manually authored. The first 20 KB contained 43 complete chat rows. Twelve inspected outputs ranged from 1 to 187 words; some were coherent miniature essays, others fragments. Search-visible rows repeat a post verbatim and include URLs and persona-specific identity claims. Do not label this official or verified synthetic. Even after deduplication and attribution review, it is too small to replace the broader grammar corpus.

### Gwern: clearer rights, different voice

The [author's license section](https://gwern.net/about#license) explicitly states CC0, and individual page sources are available by appending `.md`. The site's own size figure—over 4.38M words—is dated November 2022 and includes transcribed documents, so it is not a current count of eligible original prose. A conservative selection would keep authored essay passages and omit embedded third-party quotations, mirrors, bibliographies and code. The [fiction index](https://gwern.net/fiction/index) and [curated GPT-3 writing page](https://gwern.net/gpt-3) contain stranger creative material; distinguish the author's prose, model-generated samples, prompts and failure examples instead of mixing all roles. No bulk download was performed.

### AI-Culture: potentially useful English philosophy

Current revision: `18780c4910c51bf145c3c1d17e804b9820796c73`. The card describes editorially produced articles and parallel translations. DOLMA records expose `text`, source URL, language, `translation_of`, license and word count. Its 66 MB compressed / 254 MB JSON figures cover all languages. Select English only, group translations by original URL before splitting, and discard raw HTML fields. Publisher claims about quality and originality were not independently verified here. The tone is mostly formal philosophical argument, so this is a coherence supplement rather than the target persona.

## Recommended next bounded check

1. Resolve the official archive's reuse terms before importing its text into a publicly distributed model. Do not substitute the mirror's `other` label for permission.
2. Manually inspect 30 complete first-person turns or paragraphs per candidate, retaining source URL, speaker, document ID and license. Score readable grammar, topic continuity, original machine voice and required 8K-vocabulary attrition separately.
3. Hold out whole conversations, essays and translation families. Keep complete paragraphs or contiguous multi-paragraph spans; do not stitch disconnected sentences to inflate size.
4. If proceeding under already explicit licenses, start with a bounded selection of Gwern-authored and English AI-Culture prose plus the original GH0ST monologues. Keep this separate from any later authorized Backrooms sample. CT-agents can inform a small style evaluation but should not dominate training.
5. Measure retained **words and independent source documents**, not multilingual duplicates, lines, or every possible paragraph window. A larger vocabulary may preserve this adult material better than the current 8,192-word filter.

No candidate examined here by itself establishes a large, clean, licensed, first-person GH0ST voice corpus. These are data options and provenance findings, not a claim that another training run will fix the model.
