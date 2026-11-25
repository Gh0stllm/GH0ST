# GH0ST / Short-prompt sprites

GH0ST generates 48×48 sprites from 100 supported animal names and color requests. The [frozen manifest](manifest.json) pins the seven data shards. The appearance dictionary contains the curated traits used by a trained drawing planner and renderer. [Appearance dictionary and references](LEXICON.md)

![Actual samples](samples.png)

## Robinhood deployment

The model is deployed at [`0x00C2dC9E8402f14616C14b4d046362CAdE1914B7`](https://robinhoodchain.blockscout.com/address/0x00C2dC9E8402f14616C14b4d046362CAdE1914B7) on chain 4663. One atomic transaction installed the seven shards, matrix kernel, and model. The canonical receipt used **10,344,756 gas**, with a fee of **0.000212501977752 ETH**, in block **123,148,460**. [Robinhood receipt](https://robinhoodchain.blockscout.com/tx/0xeb24fc76c53c00aa58c3f70b6dc00c6acb5a05eabc564d9ae80f74122eeb7fcf)

Live calls to the deployed model reproduced **14 of 14** reference images byte for byte. The release verifier read back the exact child runtime hashes and model configuration. [Deployment and output evidence](deployment-verified.json) · [Test vectors](vectors.json) · [Release verifier](verify-deployment.cjs)

[Animal Sprites is live in Image Studio](https://gh0st.fyi/image-studio/?model=animal&prompt=a%20fox&seed=7). The production release binds the canonical receipt, model ID, code commitment, and runtime hash before enabling generation. [Studio source](site/) · [Production release evidence](site/release.json)
