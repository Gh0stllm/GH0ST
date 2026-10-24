# V7 runtime assessment

V6 established execution, not language quality. Its final trained checkpoint used at most27,901,073 gas per complete swap across260 real local swaps, with exact256-step state/logit agreement. Its one-layer GRU224 still produced broken grammar and drifting subjects in both float and Q10. The small matched-history numerical drift does not explain most of that language failure.

The V6 scalar matrix count is150,528 recurrent +4,032 feature +43,008 output-head MACs =197,568 per word. The old input projection is precomputed exactly, so it is not a per-swap matrix multiply. No separate per-stage gas profile has been measured; scaling gas by these counts is only a planning heuristic.

## Most reliable constrained alternative

A small trained story planner chooses semantic actions; a typed grammar realizes them. Persistent memory holds four named objects/entities, the current topic, discourse phase, last assertion and unfinished intention. An action may introduce an entity, observe it, question its role, discover a consequence, react or return to an unfinished point. Type/state rules prevent reference to an unknown object or a direct contradiction of a tracked property.

The planner predicts bounded semantic slots rather than every word. A bounded abstract syntax tree then realizes a complete clause, handling first-person subject, number, tense, pronouns and punctuation. Lexicon entries, morphology and short grammatical productions are stored; complete finished sentences are not. A clause can combine a subject, predicate, argument, modifier and connective without any prewritten full-sentence lookup. Even so, this is a hybrid neural/grammar storyteller, not an unconstrained LLM, and its realizable meanings are bounded by the authored schema.

A GRU128 planner with up to128 total candidate logits and16 numeric features costs49,152 +16,384 +6,144 =71,680 MACs. Entity embeddings can contribute separately precomputed input rows, avoiding a new dense projection over the whole memory. A sensible *unmeasured design target* is16–20M whole-swap gas including a bounded renderer, with a hard32M rejection ceiling. Emit at most256 bytes and use at most64 AST nodes/depth8 per step. A proof could first keep GRU224 and reduce the head to128 planner logits (183,232 MACs), then measure before shrinking. Neither target is a benchmark result.

This route most directly addresses grammatical validity and persistent subjects, but the author-specified action system limits free expression. Compositional variation counts are not evidence of10,000 interesting or coherent sentences.

## Neural-only alternative now prioritized

Two GRU128 layers provide a different representation while staying near the measured compute envelope. Only the first layer's token input can be precomputed. The second layer consumes the fresh first-layer state and therefore needs both an input and recurrent multiply:

- First-layer recurrence:49,152 MACs.
- Second-layer input plus recurrence:98,304 MACs.
- First-layer six features:2,304 MACs.
-128+64 adaptive word head:24,576 MACs.
- Five punctuation logits on the second-layer state:640 MACs, plus selected-word biases.
- Total:174,976 MACs, with768 GRU gate evaluations and256 stored state values.

This is below V6's matrix count, but has more gate operations and two dependent layers. A local measured prototype is required before asserting it fits32M. The punctuation head can learn clause termination independently from word spelling; it cannot guarantee agreement or coherence. Predicting a punctuation class is still a neural decision. There is no rule that inserts a period after a fixed word count.

Two GRU144 layers with the same adaptive192-logit head would require216,864 MACs before punctuation, above V6. A full512-way subword head is also materially more expensive than a factorized head. Those variants cannot be assumed to fit merely because their parameter counts are small.

## Attention option

A small32-position transformer cache gives explicit recent context but adds normalization, softmax, cache reads/writes and positional arithmetic. A two-layer96-wide transformer with a2x feed-forward expansion needs roughly147,456 dense MACs,12,288 attention MACs and4,608 MACs for a32x16 adaptive output head. This is an unmeasured architecture estimate. Increasing to the usual4x feed-forward expansion raises dense work to221,184 MACs. Short context still does not preserve an object for a long narrative, so explicit entity memory remains useful. It is more implementation work than the two-layer GRU and does not have an available proven checkpoint here.

## Research context

Explicit content tracking has precedent in [Neural Checklist Models](https://aclanthology.org/D16-1032/); dynamic entity representations are studied in [EntityNLM](https://aclanthology.org/D17-1195/). [NeuroLogic Decoding](https://aclanthology.org/2021.naacl-main.339/) studies lexical constraints during generation. These motivate separating memory/constraints from an implicit hidden state; they do not establish gas feasibility or guarantee our model's prose quality.

All proposals and prototypes are local only. V6 source and results remain unchanged.
