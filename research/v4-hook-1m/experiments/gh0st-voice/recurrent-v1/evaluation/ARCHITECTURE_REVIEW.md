# Recurrent model evaluation notes

This is a local research candidate. Language quality and gas are separate gates.

The current architecture has 4,492,256 parameters, with an 8,192-word output
vocabulary and a 265-value recurrent state. Most parameters are the input
embedding and hierarchical output table. Each emitted word costs two 265-by-265
matrix products, a small feature projection, and 13 output-node dot products.
It does not perform a dense 8,192-word output scan. The architecture can therefore
be cheaper per complete word than the existing transformer per subword.

The old 4.49M prototype saw only 124 target words and 641 output-tree nodes during
training. Its validation loss and favorable gas did not establish broad language
ability. The new data preparation fixes that specific defect: all 8,192 vocabulary
leaves occur in retained real training sentences, no padding words or output EOS
are inserted, and words fit the hook's 32-byte limit. Corpus coverage remains
uneven; repeated exposure to a small authored subset does not create new authored
information.

The recurrent state uses a clipped ReLU Elman update, with no learned forget or
update gates. This may lose useful context, retain a repetitive attractor, or
saturate. Its training objective is next-word hierarchical binary cross entropy
on gold histories; low held-out loss does not establish stable free generation.
Short training windows and resets can also differ from uninterrupted pool use.
The evaluation therefore starts once, carries state for all 128 words, and never
appends punctuation at the output cap. A terminal punctuation flag is
observational and must not reset the model.

The binary output tree is a valid conditional word distribution, but taking the
most likely branch at each level is not the same as finding the globally most
likely word. Sampling temperature acts on each branch, not on a conventional
flat softmax. Comparisons must use the exact declared decoder. Bit-reversing
frequency ranks distributes common words across subtrees; it does not confer
semantic structure or solve grammar.

The initial gate is four fixed seeds, 128 words each, with complete raw outputs.
Human review checks grammatical clauses, continuity across at least three
sentences, a consistent first-person voice, and semantic repetition. Numeric
checks count repeated normalized four-word spans, exact normalized twelve-word
training matches, complete copied sentences, and dead/saturated hidden values.
No single metric is treated as proof of a successful voice. FP32 results must be
rechecked with exact Q10 arithmetic and an actual v4 transaction before use.

If the Elman model fails the continuity gate, a trained GRU with state size 160 is
a plausible separate experiment. Its six recurrent/input matrices cost 153,600
multiply-accumulates per step, near the Elman core's 140,450. The GRU's complete
parameter count with the same vocabulary would be approximately 2.787M, not
4.49M. Learned gates may improve memory, but sigmoid/tanh evaluation, three
bias paths, exact reset-gate convention and fixed-point rounding must all be
benchmarked. A 256-state GRU would reach roughly 4.59M parameters while increasing
the recurrent matrix work to 393,216 multiply-accumulates; it should not be
assumed to fit the current gas budget.
