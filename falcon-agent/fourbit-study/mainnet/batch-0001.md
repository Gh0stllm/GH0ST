# GH0ST four-bit RH deployment batch

Status: batch_complete_paused

This invocation verified 25 contracts; 718,440,406 gas; 0.015045528624360000 ETH.

Transactions are independent; HTTP bundling is not atomic and does not itself reduce chain gas.

| Measure | Value |
|---|---:|
| Four-bit contracts complete / planned | 25 / 497 |
| Old six-bit contracts retained | 2 |
| Wallet balance | 0.025397040585912000 ETH |
| Four-bit contracts remaining | 472 |
| Estimated remaining gas | 14,203,269,066 |
| Estimated remaining fee at snapshot price | 0.299944636135788000 ETH |
| Next batch quoted maximum | 0.016728828762960120 ETH |
| Reserve | 0.002000000000000000 ETH |
| Suggested top-up for next batch | 0.000000000000000000 ETH |

Snapshot (UTC): 2026-10-20T15:19:20.012737+00:00
Local Cancun gas calibrated by live estimates/receipts; RH posting fees and prices may change. Index gas provisional.

No automatic next batch. RH receipts are not a claim of Ethereum finality.
Scope: immutable weights, matrix kernel and final index. Full inference is not implemented.

The original 25-contract batch is complete: one previously deployed kernel plus weight shards 0000–0023. The 24 new lossless deployments used the original deterministic addresses, with unchanged weight bytes. The rejected raw hashes were checked absent, then archived; transient base-fee rejections were recovered with identical signed replacement hashes and no fee increases. No rejected submission consumed gas.

The aggregate fee cap was 0.016 ETH and the wallet reserve was 0.002 ETH. Balance reduction exactly equals receipt fees. There are 27 deployed contracts including the two old six-bit pilot contracts, with 472 contracts remaining in this 499-contract stage. No further batch was started.

Lossless decompression fixes transaction-size admission but increases local stage deployment gas from 10.554 billion to 14.809 billion. It does not change model precision or inference gas. All 495 creation payloads are locally verified; the remaining 471 weight contracts and final index are not yet deployed.

[Exact receipts and addresses](batch-0001.json) · [Deployment journal](deployment-state.json) · [Final reconciliation](reconciliation.json) · [Creation validation](../creation-validation.json)

## Verified contracts

| Contract | Address | Gas | Fee (ETH) |
|---|---|---:|---:|
| FourBitAffine64 | [0x0200026e314067c01ac69665d2386d45d156e7b8](https://robinhoodchain.blockscout.com/address/0x0200026e314067c01ac69665d2386d45d156e7b8) | 1,150,404 | 0.000023870883 |
| fourbit-weights-0000 | [0x8765fcb1b69bbb848d13f8c0dc842a96e794ddf1](https://robinhoodchain.blockscout.com/address/0x8765fcb1b69bbb848d13f8c0dc842a96e794ddf1) | 29,729,884 | 0.000625695139 |
| fourbit-weights-0001 | [0x58a44cdb166dba06810a2d50dcb0d8cdbba899a6](https://robinhoodchain.blockscout.com/address/0x58a44cdb166dba06810a2d50dcb0d8cdbba899a6) | 29,768,349 | 0.000626802357 |
| fourbit-weights-0002 | [0x777644141e7169a444be5a880849eb01a94bae18](https://robinhoodchain.blockscout.com/address/0x777644141e7169a444be5a880849eb01a94bae18) | 29,778,078 | 0.000619264910 |
| fourbit-weights-0003 | [0x7f8cecc7134719176cf075815b217397f1f897c7](https://robinhoodchain.blockscout.com/address/0x7f8cecc7134719176cf075815b217397f1f897c7) | 29,778,008 | 0.000619620790 |
| fourbit-weights-0004 | [0xd748ac1c5fca0ff7fc38cdf8a8129331770329ea](https://robinhoodchain.blockscout.com/address/0xd748ac1c5fca0ff7fc38cdf8a8129331770329ea) | 29,784,614 | 0.000626489571 |
| fourbit-weights-0005 | [0x43da4c9d6f0e940abc777b36fe0e5927806d705b](https://robinhoodchain.blockscout.com/address/0x43da4c9d6f0e940abc777b36fe0e5927806d705b) | 29,916,975 | 0.000621375571 |
| fourbit-weights-0006 | [0xee088488d1e8f5ea5a6386ab0104a880b6ce40c1](https://robinhoodchain.blockscout.com/address/0xee088488d1e8f5ea5a6386ab0104a880b6ce40c1) | 29,863,220 | 0.000624858015 |
| fourbit-weights-0007 | [0x6aefc8817299c68476953c3aa489085be3726149](https://robinhoodchain.blockscout.com/address/0x6aefc8817299c68476953c3aa489085be3726149) | 29,918,509 | 0.000628348526 |
| fourbit-weights-0008 | [0x2aa6f8b06c39b76a2a50b33f4aef85aeca8d29f4](https://robinhoodchain.blockscout.com/address/0x2aa6f8b06c39b76a2a50b33f4aef85aeca8d29f4) | 29,922,389 | 0.000624061345 |
| fourbit-weights-0009 | [0x2dd52794fc820825f58dab0f54180bc7a8419607](https://robinhoodchain.blockscout.com/address/0x2dd52794fc820825f58dab0f54180bc7a8419607) | 29,920,493 | 0.000627013851 |
| fourbit-weights-0010 | [0x83f6c6f06fe52f429fe19855bc929f128bfa163d](https://robinhoodchain.blockscout.com/address/0x83f6c6f06fe52f429fe19855bc929f128bfa163d) | 29,922,106 | 0.000623397156 |
| fourbit-weights-0011 | [0x4c693d833e3f1edd6ea0850bbd0f6c542128bada](https://robinhoodchain.blockscout.com/address/0x4c693d833e3f1edd6ea0850bbd0f6c542128bada) | 29,921,306 | 0.000631937983 |
| fourbit-weights-0012 | [0xd4fadae40a4512b1371cf5f393da1ce857592e8b](https://robinhoodchain.blockscout.com/address/0xd4fadae40a4512b1371cf5f393da1ce857592e8b) | 29,921,024 | 0.000623793508 |
| fourbit-weights-0013 | [0xa928638103ed097bf546a46ebc5310a32772deaf](https://robinhoodchain.blockscout.com/address/0xa928638103ed097bf546a46ebc5310a32772deaf) | 29,919,950 | 0.000635439898 |
| fourbit-weights-0014 | [0xdd3299f2630873e81af16ee63657de93debe58d9](https://robinhoodchain.blockscout.com/address/0xdd3299f2630873e81af16ee63657de93debe58d9) | 29,921,797 | 0.000622612752 |
| fourbit-weights-0015 | [0xb156e76aaa91e8fedad55d93912c87cd8a2bc6c5](https://robinhoodchain.blockscout.com/address/0xb156e76aaa91e8fedad55d93912c87cd8a2bc6c5) | 29,921,992 | 0.000623993221 |
| fourbit-weights-0016 | [0x67b9d9faa816f483d48f6c87ebfbb9f166fc2067](https://robinhoodchain.blockscout.com/address/0x67b9d9faa816f483d48f6c87ebfbb9f166fc2067) | 29,922,683 | 0.000625324229 |
| fourbit-weights-0017 | [0x353b5329e3fdd63236b347043ff77460b2ba5154](https://robinhoodchain.blockscout.com/address/0x353b5329e3fdd63236b347043ff77460b2ba5154) | 29,923,332 | 0.000621746992 |
| fourbit-weights-0018 | [0x92ed7280a78368ba1e8468f65773ed44f83a3947](https://robinhoodchain.blockscout.com/address/0x92ed7280a78368ba1e8468f65773ed44f83a3947) | 29,923,753 | 0.000629655611 |
| fourbit-weights-0019 | [0x0cc3b7b9fd525a169991531d095c1af4479a84ea](https://robinhoodchain.blockscout.com/address/0x0cc3b7b9fd525a169991531d095c1af4479a84ea) | 29,921,241 | 0.000631098815 |
| fourbit-weights-0020 | [0x3cf45b34a8a74201ea1f6dbd0b92acc343a4718f](https://robinhoodchain.blockscout.com/address/0x3cf45b34a8a74201ea1f6dbd0b92acc343a4718f) | 29,922,068 | 0.000628961869 |
| fourbit-weights-0021 | [0xe68cad6aba416576731d31fac750ddf245355203](https://robinhoodchain.blockscout.com/address/0xe68cad6aba416576731d31fac750ddf245355203) | 29,923,218 | 0.000621804470 |
| fourbit-weights-0022 | [0x33f34dbdadf2e70f8789d3ba3d8e942ed33e8f40](https://robinhoodchain.blockscout.com/address/0x33f34dbdadf2e70f8789d3ba3d8e942ed33e8f40) | 29,922,125 | 0.000626329921 |
| fourbit-weights-0023 | [0x95a9384dc4606fd8692b51208c03a30263554405](https://robinhoodchain.blockscout.com/address/0x95a9384dc4606fd8692b51208c03a30263554405) | 29,922,888 | 0.000632031240 |
