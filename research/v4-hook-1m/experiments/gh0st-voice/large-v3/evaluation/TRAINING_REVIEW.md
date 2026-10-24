# Independent training-language review

This is a rolling qualitative review of complete saved probe streams. A checkpoint is read only after `training-metadata.json` exists. Each probe is a 512-token closed-loop FP32 continuation with seeds 0 and 42. These probes are not exact-Q12 output or evidence of on-chain quality. All text from both streams is reviewed; an attractive opening alone does not pass a checkpoint.

`training-probe-inspection.json` independently checks literal twelve-word reuse against all train-split source kinds: authored, compositional, and historical prose. Absence of a match does not establish novelty relative to the original model's pretraining or guarantee meaningful prose.

## Completed checkpoints

| Step | Trained target tokens | Language assessment |
|---:|---:|---|
| 0 | 0 | Untouched story model: child characters, generic fantasy, and repeated friendship/adventure endings. Not the requested voice. |
| 500 | 633,590 | First-person and machine-related nouns appear, but clauses and referents collapse. Neither complete stream passes the language gate. |
| 1,000 | 1,271,590 | More of the corpus's props and phrases appear; meaningful connections still fail. Both streams remain unready. |
| 1,500 | 1,910,283 | First-person and recurring props persist, but both streams remain grammatically and semantically broken. |
| 2,000 | 2,546,519 | Still unready: multiple broken word forms, incomplete clauses, and no stable development of a thought. |
| 2,500 | 3,183,070 | Isolated clear clauses occur inside streams that remain malformed and semantically unstable. |

### Step 500

Seed 0 moves from a light to a person, room, door, and machine without maintaining what those objects mean. “the door is only a person” and “if i have a new eyes, it will be” are examples of semantic and grammatical failure, not intentional wit.

Seed 42 repeatedly places lights and mirrors, but cannot consistently connect actions to a consequence. “the person whose names are the first person of the room” is an incomplete thought. “the mirror showed me what the glass was enough” is grammatically broken. The machine voice is a topical change; it is not yet a coherent persona.

### Step 1,000

Seed 0 returns repeatedly to a bell, button, and box. “the bell kept its bell” and “the button gave everybody the button” repeat relationships without adding a usable thought. “a machine can explain what a perfect work for me” is an incomplete construction.

Seed 42 shifts through hat, lock, box, door, question, and line. Some brief sentences are grammatical, but adjacent sentences rarely establish why the next object appears. “the box had become a gate that had never been anyone had to believe” is a clear grammar failure. “i gave the message a machine that could keep the question in the lock” illustrates the mixing of unrelated props without a clear metaphor.

### Metrics versus meaning

All step-500 and step-1,000 streams pass the trainer's basic repetition, vocabulary, EOS, and authored-copy guards. The independent check finds no exact twelve-word reuse from any of the three current training source kinds. These are useful mechanical checks, but the examples above show why they cannot certify English quality or continuity.

Further training remains an experiment. No checkpoint listed here is recommended for deployment or for a new gas test solely on the basis of these probes.


### Steps 1,500 and 2,000

All four complete streams were reviewed. At step 1,500, examples include “the window was feeling like an acquiredus” and “the light found a ladder whose problem the path.” At step 2,000, the model generates forms such as “moreuity” and “visionful,” and clauses such as “i would like to return i than another day.” Props from the training corpus appear, but their causal and grammatical relationships do not reliably transfer.

The step-2,000 seed-42 stream successively moves through machine, scale, book, light, bell, crown, lamp, ladder, coin, and mirror. This topic inventory resembles the corpus, but it does not develop one meaningful thread. These streams should not pass the English or continuity gate.

### Step 2,500

Both complete streams remain below the language gate. Seed 0 contains “the button gave the button to the screen its own owner” and the malformed word “visitoridrapid.” Seed 42 includes “lungsu” and moves between jar, mirror, radio, recipe, and light without stable referents. The clear sentence “the plan became less impressive and more useful” is not representative of the entire stream and must not be used alone to characterize the checkpoint.
