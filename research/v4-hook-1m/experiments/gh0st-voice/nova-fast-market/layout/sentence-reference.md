# N0VA neural sentence reference — local CPU only

Unchanged quantized model. Each sentence starts with zero hidden state and BOS. Neural punctuation ends generation; no EOS or punctuation is forced. This is not an EVM gas or throughput test.

## fixed-neutral

Frozen features: `[0, 0, 0, 0, 1024, 1024]`.

- Seed 42: 20 words, natural terminal=True: the cost cache in the demo screen with a current label alone at every expected word for a short scale.
- Seed 43: 13 words, natural terminal=True: the event balance in the trial named on the local network appeared together.
- Seed 44: 17 words, natural terminal=True: i compared the sample quote in the test channel and found a clear number for the draft.
- Seed 45: 15 words, natural terminal=True: i followed the short light in the practice machine had a reason to remember it.
- Seed 46: 21 words, natural terminal=True: i followed the test timer in the window stopped twice but it worked that made a required task than every short.
- Seed 47: 12 words, natural terminal=True: i read the quote of the request reply in the shared service.
- Seed 48: 14 words, natural terminal=True: i watched the review request in the trial gave a reference by a simple.
- Seed 49: 15 words, natural terminal=True: i opened the source chart in the local screen in the reference and exactly the.
- Seed 50: 11 words, natural terminal=True: the test note in the demo stopped on the current date.
- Seed 51: 17 words, natural terminal=True: i followed the status note in the spare network had a reason to match without another case.
- Seed 52: 14 words, natural terminal=True: i saw a service to found a machine to tell the whole local machine.
- Seed 53: 14 words, natural terminal=True: i noticed that the service deadline in the local machine had a normal reason.
- Seed 54: 14 words, natural terminal=True: the spare image in the group request to expired without its record and calling.
- Seed 55: 16 words, natural terminal=True: i followed the review on the trial and found a reference about its owner and stopped.
- Seed 56: 19 words, natural terminal=True: i found a second quote in the small machine for a reference and found a word to the correct.
- Seed 57: 19 words, natural terminal=True: i compared the quote of the test note in the old system had a large number to its name.

{"sentences": 16, "naturally_completed": 16, "cap_hits": 0, "minimum_words": 11, "maximum_words": 21, "mean_words": 15.6875}

## representative-buy

Frozen features: `[68, 0, 68, 54, 1024, 1024]`.

- Seed 42: 20 words, natural terminal=True: the cost cache in the demo screen with a current label alone at every expected word for a short scale.
- Seed 43: 13 words, natural terminal=True: the event balance in the trial named on the local network appeared together.
- Seed 44: 17 words, natural terminal=True: i compared the sample quote in the test channel and found a clear number for the draft.
- Seed 45: 15 words, natural terminal=True: i followed the short light in the practice machine had a reason to remember it.
- Seed 46: 21 words, natural terminal=True: i followed the test timer in the window stopped twice but it worked that made a required task than every short.
- Seed 47: 12 words, natural terminal=True: i read the quote of the request reply in the shared service.
- Seed 48: 14 words, natural terminal=True: i watched the review request in the trial gave a reference by a simple.
- Seed 49: 15 words, natural terminal=True: i opened the source chart in the local screen in the reference and exactly the.
- Seed 50: 11 words, natural terminal=True: the test note in the demo stopped on the current date.
- Seed 51: 17 words, natural terminal=True: i followed the status note in the spare network had a reason to match without another case.
- Seed 52: 14 words, natural terminal=True: i saw a service to found a machine to tell the whole local machine.
- Seed 53: 14 words, natural terminal=True: i noticed that the service deadline in the local machine had a normal reason.
- Seed 54: 14 words, natural terminal=True: the spare image in the group request to expired without its record and calling.
- Seed 55: 16 words, natural terminal=True: i followed the review on the trial and found a reference about its owner and stopped.
- Seed 56: 19 words, natural terminal=True: i found a second quote in the small machine for a reference and found a word to the correct.
- Seed 57: 19 words, natural terminal=True: i compared the quote of the test note in the old system had a large number to its name.

{"sentences": 16, "naturally_completed": 16, "cap_hits": 0, "minimum_words": 11, "maximum_words": 21, "mean_words": 15.6875}


All 16 seed outputs are distinct within each scenario, but all 16 matched across the two feature vectors. This does not establish market-responsive text. Several outputs have grammatical problems; terminal completion is not a fluency test.
