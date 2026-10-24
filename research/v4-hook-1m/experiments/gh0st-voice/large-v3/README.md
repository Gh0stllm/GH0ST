# Large-corpus GH0ST voice experiment

This is a separate local-only continuation of the voice research. It preserves the fixed 1,235,968-parameter SimpleStories V2 architecture, tokenizer, Q12 numerical format and 64-position attention window. The intended voice is an original first-person machine narrator with wit, curiosity and readable absurdity, inspired by high-level traits of Truth Terminal. No Truth Terminal passages or identity are copied into training.

## Current published research milestone

The corrected combined corpus is now **78,102 passages / 7,518,466 tokenizer tokens**, with 13,428 licensed teacher paragraphs added to the original corpus below. Four training comparisons are complete. The current weights still fail long-form language quality. See [RESULTS.md](RESULTS.md) before interpreting any checkpoint or gas result as a release candidate. Compressed data in GitHub is restored with the publication helper.

## Original large corpus

The versioned corpus contains **64,674 passages and 6,433,128 tokenizer tokens**, about **561 times** the previous 11,462-token corpus. These are corpus positions, not 6.4 million unique words.

| Source | Documents | Role |
|---|---:|---|
| Authored GH0ST monologues | 433 | Original synthetic voice examples, including 230 new essays |
| Offline compositional passages | 61,440 | Coherent combinations from 60 authored paragraph families |
| Attributed public-domain prose | 2,801 | Broader English prose, satire, nature and philosophical discussion |

The composition count is not a count of independently authored essays. Each family contains several compatible alternatives for each sentence; full paragraphs are assembled offline. These paragraphs are training data only. The model contract has no sentence list, family templates or text-selection code.

The public-domain foundation retains its original downloads, source URLs, credits and license text under `data/foundation/`. Sources are Project Gutenberg editions of Ambrose Bierce's *The Devil's Dictionary*, Oscar Wilde's *The Soul of Man under Socialism*, G. K. Chesterton's *Tremendous Trifles*, William James's *Pragmatism*, and Henry David Thoreau's *Walden and Civil Disobedience*. They supply a small training mixture rather than GH0ST's identity or an endorsement of their claims. Cleaning excludes metadata, some historical slurs and unknown-token paragraphs; details are recorded per book.

There are 51,737 training, 6,473 validation and 6,464 test passages. All 60 compositional families are assigned wholly to one split: 48 train, 6 validation, 6 test. Foundation paragraphs are split in nonoverlapping source groups. Authored splits have no exact twelve-word overlap. The full normalized corpus contains 15,438 distinct sentence strings; this is not evidence that the trained model will generate 10,000 good sentences.

## Training and evaluation

The cached trainer records actual supervised tokens, source proportions, checkpoint hashes and fixed-window settings. Default source sampling is 30% authored, 60% compositional and 10% public-domain by sampled block. Because block lengths and quote-start supervision differ, effective supervised-token shares are reported separately. Repeated exposure to a source is not reported as additional unique corpus data.

Training uses continuous prose without inserted end markers. Some windows begin with the same quotation token used by the hook. Model size and vocabulary cannot silently expand. Signed matrix and norm bounds are explicitly enforced and any projected values are counted. Validation and complete free-running transcripts are retained at checkpoints; a low prediction loss does not establish good writing.

The final chosen checkpoint must undergo exact integer generation, copy/repetition inspection, and actual local v4 swaps. The local adapter requires chain 31337, checks Anvil identity, enforces the 32,000,000 whole-transaction gas cap and preserves state across swaps. It has no public RPC or mainnet broadcast option.

## Files

- `data/corpus/manifest.json`: corpus size, provenance and split hashes.
- `data/corpus-audit.json`: independent counts and deterministic samples.
- `data/foundation/source-manifest.json`: original book download URLs and hashes.
- `training/`: cache preparation, balanced trainer and numerical self-tests.
- `evaluation/`: corpus and model quality reviews.
- `evm/`: local v4 adapter, compiler records and measured swap results when available.

See `RESULTS.md` for the completed result. Checkpoint files or preparation reports alone do not indicate that quality or gas tests passed.
