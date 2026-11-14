# GH0ST Forge

A creator interface for small numerical models that can execute directly on Robinhood Chain. Reuses Synapse's bounded fixed-point inference, bytecode weight storage and exact GH0ST payment accounting.

## Building

Implementation is in progress on `research/gh0st-forge`. Intended release: browser CSV import, private in-browser training, held-out evaluation and baseline comparison, integer inference preview, portable model export, gas estimates and explicit creator-wallet deployment.

The first version has up to eight numerical features, one small hidden layer and two to four output classes. It does not train or deploy arbitrary language models. Training occurs in the browser; no new ICP training service or model deployment is claimed. Creator deployments require their own wallet approval and native network gas. Creation is free for this first release; creators can optionally charge GH0ST per paid prediction through their deployed model.

Existing Synapse contracts and balances remain untouched. No mainnet financial transaction is performed by the build or website publication.
