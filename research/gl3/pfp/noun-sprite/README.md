# GH0ST / Short-prompt sprites

An immutable 48×48 text-to-sprite model for Robinhood Chain. It resolves 100 supported animal names and appearance traits, predicts a drawing plan with a quantized neural network, then renders the pixels in Solidity. Generic synthetic layouts trained the planner. Named profiles were held out of drawing training.

![Actual samples](samples.png)

The [frozen manifest](manifest.json) pins each of the seven model data shards. [Read-only Robinhood results](robinhood.json) record 14 byte-exact generations, with 4.85–5.83 million gas per image. [Appearance dictionary and references](LEXICON.md).

Deployment and Image Studio integration are in preparation. This commit reports simulations.
