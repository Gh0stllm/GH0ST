# GH0ST four-bit RH deployment batch

Status: batch_complete_paused

This invocation verified 150 contracts; 4,490,657,632 gas; 0.094396516328592000 ETH.

Transactions are independent; HTTP bundling is not atomic and does not itself reduce chain gas.

| Measure | Value |
|---|---:|
| Four-bit contracts complete / planned | 175 / 497 |
| Old six-bit contracts retained | 2 |
| Wallet balance | 0.225392274146592439 ETH |
| Four-bit contracts remaining | 322 |
| Estimated remaining gas | 9,676,799,816 |
| Estimated remaining fee at snapshot price | 0.204257890516128000 ETH |
| Next batch quoted maximum | 0.165066736758278400 ETH |
| Reserve | 0.002000000000000000 ETH |
| Suggested top-up for next batch | 0.000000000000000000 ETH |

Snapshot (UTC): 2026-10-20T16:02:05.106076+00:00
Local Cancun execution gas calibrated by live total estimates/receipts including parent posting; RH prices may change. Index gas provisional.

No automatic next batch. RH receipts are not a claim of Ethereum finality.
Scope: immutable weights, matrix kernel and final index. Full inference is not implemented.

The authorized second review batch is complete: **150 new contracts**, immutable weight shards 0024–0173. The first25 previously rejected low-fee hashes were reconciled before their journal was archived and higher-ceiling replacements were signed following user authorization. The remaining contracts used funded subgroups of at most four. No contract was deployed twice and no third review batch was started.

Execution used 4,490,657,632 gas. Parent posting used 0 additional gas and cost 0.000000000000000000 ETH. Unused gas-limit headroom was not charged. There are 175 verified four-bit stage contracts, or 177 including the two historical pilots, with 322 remaining in this 499-contract stage. All 175 receipts and complete runtime bytes were rechecked after completion. Latest/pending nonce: 177/177.

The user funded the wallet during execution. Net balance additions since the pre-batch balance were 0.294391749889272439 ETH, calculated as closing balance minus opening balance plus actual receipt fees. This is a balance-flow reconciliation, not a claim that balance reduction alone equals fees.

Next-batch figures above quote 150 remaining contracts at the snapshot market price, with 20% per-gas ceiling headroom and a posting-gas reserve; they are budgets, not an instruction to deploy or a guarantee about future prices. Current model precision and deployed kernel/weight bytes are unchanged. Full inference remains unimplemented.

[Exact receipts and addresses](batch-0002.json) · [Deployment journal](deployment-state.json) · [Logical progress journal](batch-0002-logical-run.json) · [Final reconciliation](batch-0002-reconciliation.json)

## Verified contracts

| Contract | Address | Gas | Fee (ETH) |
|---|---|---:|---:|
| fourbit-weights-0024 | [0xdaf6534b485ef69a20973f9d95c3bcf3146e1d8b](https://robinhoodchain.blockscout.com/address/0xdaf6534b485ef69a20973f9d95c3bcf3146e1d8b) | 29,922,178 | 0.000621603325772000 |
| fourbit-weights-0025 | [0x45977c37bc276cc7647167ab2d5ebc9a5f72d5f0](https://robinhoodchain.blockscout.com/address/0x45977c37bc276cc7647167ab2d5ebc9a5f72d5f0) | 29,921,254 | 0.000624037673424000 |
| fourbit-weights-0026 | [0x96724ba740dd8eef3a8bb6681cb97dd1e8b32ac5](https://robinhoodchain.blockscout.com/address/0x96724ba740dd8eef3a8bb6681cb97dd1e8b32ac5) | 29,920,471 | 0.000625158321074000 |
| fourbit-weights-0027 | [0x40eb1ca89ca4a2388401ace1d0c1bfe3fb0b0196](https://robinhoodchain.blockscout.com/address/0x40eb1ca89ca4a2388401ace1d0c1bfe3fb0b0196) | 29,921,046 | 0.000636839543064000 |
| fourbit-weights-0028 | [0xfb2fa5e772f0af4b82c8344b374f6dbcd5e67327](https://robinhoodchain.blockscout.com/address/0xfb2fa5e772f0af4b82c8344b374f6dbcd5e67327) | 29,920,488 | 0.000624620107488000 |
| fourbit-weights-0029 | [0x2a6b727166714f8950c5963c7c821e489c48d2b0](https://robinhoodchain.blockscout.com/address/0x2a6b727166714f8950c5963c7c821e489c48d2b0) | 29,925,093 | 0.000625015492398000 |
| fourbit-weights-0030 | [0xcf69b55e84d2c5dd49fe8c0d2b4818578addb221](https://robinhoodchain.blockscout.com/address/0xcf69b55e84d2c5dd49fe8c0d2b4818578addb221) | 29,920,737 | 0.000625044195930000 |
| fourbit-weights-0031 | [0x1285a22491be6b1d839703a5dc843caba3dac42e](https://robinhoodchain.blockscout.com/address/0x1285a22491be6b1d839703a5dc843caba3dac42e) | 29,921,597 | 0.000623207022316000 |
| fourbit-weights-0032 | [0x684670599fc3f26456cd452a4b08eff01266b88d](https://robinhoodchain.blockscout.com/address/0x684670599fc3f26456cd452a4b08eff01266b88d) | 29,922,539 | 0.000622089585810000 |
| fourbit-weights-0033 | [0x293d1f72f48836c1cea65d0763e8d35d876533fc](https://robinhoodchain.blockscout.com/address/0x293d1f72f48836c1cea65d0763e8d35d876533fc) | 29,925,530 | 0.000627298959860000 |
| fourbit-weights-0034 | [0x4302008c174b9937a0c745491cc97011ab67346f](https://robinhoodchain.blockscout.com/address/0x4302008c174b9937a0c745491cc97011ab67346f) | 29,921,289 | 0.000626851004550000 |
| fourbit-weights-0035 | [0x1cc136ae20c9dc1be97c3b02ab7dd904bdfc6382](https://robinhoodchain.blockscout.com/address/0x1cc136ae20c9dc1be97c3b02ab7dd904bdfc6382) | 29,923,035 | 0.000628682965350000 |
| fourbit-weights-0036 | [0xea1d6f4be4186b44aac581a12fd91251a01def6e](https://robinhoodchain.blockscout.com/address/0xea1d6f4be4186b44aac581a12fd91251a01def6e) | 29,919,823 | 0.000623050394152000 |
| fourbit-weights-0037 | [0x178a71f1875efb4e427575b2da68f3b1cde638f6](https://robinhoodchain.blockscout.com/address/0x178a71f1875efb4e427575b2da68f3b1cde638f6) | 29,921,430 | 0.000646721788020000 |
| fourbit-weights-0038 | [0xb929aeba1c6cac849e35e8c1354841019a094ce1](https://robinhoodchain.blockscout.com/address/0xb929aeba1c6cac849e35e8c1354841019a094ce1) | 29,920,803 | 0.000635098964478000 |
| fourbit-weights-0039 | [0xc66ce056cd6edf10298be74b465575a4fba7d953](https://robinhoodchain.blockscout.com/address/0xc66ce056cd6edf10298be74b465575a4fba7d953) | 29,920,927 | 0.000622534807162000 |
| fourbit-weights-0040 | [0x7ab19de92a3a8ea4d55311f22edeb3d23c8e6ecd](https://robinhoodchain.blockscout.com/address/0x7ab19de92a3a8ea4d55311f22edeb3d23c8e6ecd) | 29,920,210 | 0.000623597016820000 |
| fourbit-weights-0041 | [0x47ad17056ee29e0312954f17dac906a15e9c3d39](https://robinhoodchain.blockscout.com/address/0x47ad17056ee29e0312954f17dac906a15e9c3d39) | 29,920,633 | 0.000630906467438000 |
| fourbit-weights-0042 | [0x01b6381c5a7e5cbf357dbbf9d7854548e411a0b5](https://robinhoodchain.blockscout.com/address/0x01b6381c5a7e5cbf357dbbf9d7854548e411a0b5) | 29,921,375 | 0.000624518939000000 |
| fourbit-weights-0043 | [0xa54e488b0fe3c9df1bb8254c6f294dcda5ee28cf](https://robinhoodchain.blockscout.com/address/0xa54e488b0fe3c9df1bb8254c6f294dcda5ee28cf) | 29,921,503 | 0.000623623965526000 |
| fourbit-weights-0044 | [0x6d017fe511ffe0d5c0d37e9ef1d344bfdd81c4a3](https://robinhoodchain.blockscout.com/address/0x6d017fe511ffe0d5c0d37e9ef1d344bfdd81c4a3) | 29,921,668 | 0.000622610067744000 |
| fourbit-weights-0045 | [0xb79883d2a6d9c7dbf35c4dfa9abbb38c43f50879](https://robinhoodchain.blockscout.com/address/0xb79883d2a6d9c7dbf35c4dfa9abbb38c43f50879) | 29,922,400 | 0.000648538097600000 |
| fourbit-weights-0046 | [0xa0af8d655fe63373c7456e71c231c096bcd118ee](https://robinhoodchain.blockscout.com/address/0xa0af8d655fe63373c7456e71c231c096bcd118ee) | 29,922,654 | 0.000632505060252000 |
| fourbit-weights-0047 | [0xa780d21ad322fa5d7fff66fb0cbe9f87878a63fe](https://robinhoodchain.blockscout.com/address/0xa780d21ad322fa5d7fff66fb0cbe9f87878a63fe) | 29,921,096 | 0.000622239112416000 |
| fourbit-weights-0048 | [0xc1df5ca72f895738885be3d3f6a52e4486d793d0](https://robinhoodchain.blockscout.com/address/0xc1df5ca72f895738885be3d3f6a52e4486d793d0) | 29,921,151 | 0.000623616629142000 |
| fourbit-weights-0049 | [0xd21b60e10365f466c47cf3740aadad62d9bcaf51](https://robinhoodchain.blockscout.com/address/0xd21b60e10365f466c47cf3740aadad62d9bcaf51) | 29,921,258 | 0.000626730670068000 |
| fourbit-weights-0050 | [0x591453ae7c7f1d49b9315dd6418e9f8124f7ff9e](https://robinhoodchain.blockscout.com/address/0x591453ae7c7f1d49b9315dd6418e9f8124f7ff9e) | 29,921,483 | 0.000624521193176000 |
| fourbit-weights-0051 | [0xd1227aae1dcb2ff25089d03574c22eaab6d28d61](https://robinhoodchain.blockscout.com/address/0xd1227aae1dcb2ff25089d03574c22eaab6d28d61) | 29,921,506 | 0.000622786225884000 |
| fourbit-weights-0052 | [0x3ed44d4bf4da09757e8ff28ceb9a57b5a43d5684](https://robinhoodchain.blockscout.com/address/0x3ed44d4bf4da09757e8ff28ceb9a57b5a43d5684) | 29,920,702 | 0.000624385209336000 |
| fourbit-weights-0053 | [0x8b1b10990a11f8579a430ae2f89e5f59fcf7df76](https://robinhoodchain.blockscout.com/address/0x8b1b10990a11f8579a430ae2f89e5f59fcf7df76) | 29,921,759 | 0.000623928518668000 |
| fourbit-weights-0054 | [0x4b39dd61b6f8f3aac3be687e0ac0032b5fe4100b](https://robinhoodchain.blockscout.com/address/0x4b39dd61b6f8f3aac3be687e0ac0032b5fe4100b) | 29,920,984 | 0.000625049355760000 |
| fourbit-weights-0055 | [0xc07b4319c2ade32f147c2e7ae3131fbaa86c66a3](https://robinhoodchain.blockscout.com/address/0xc07b4319c2ade32f147c2e7ae3131fbaa86c66a3) | 29,921,034 | 0.000625828347144000 |
| fourbit-weights-0056 | [0xc7a6d494e6034f6289daabc4d967ab4d04e13959](https://robinhoodchain.blockscout.com/address/0xc7a6d494e6034f6289daabc4d967ab4d04e13959) | 29,921,489 | 0.000621708698442000 |
| fourbit-weights-0057 | [0xf12b3023b46f0f37fe9eabb35bef6b63ad597d07](https://robinhoodchain.blockscout.com/address/0xf12b3023b46f0f37fe9eabb35bef6b63ad597d07) | 29,922,098 | 0.000621721352244000 |
| fourbit-weights-0058 | [0x342872a44de262fd177c7d8d1c6958bc7f99c45e](https://robinhoodchain.blockscout.com/address/0x342872a44de262fd177c7d8d1c6958bc7f99c45e) | 29,919,262 | 0.000621722264360000 |
| fourbit-weights-0059 | [0x983e3a9eb2558a897edd01de56dad88c02ad245a](https://robinhoodchain.blockscout.com/address/0x983e3a9eb2558a897edd01de56dad88c02ad245a) | 29,922,310 | 0.000631719808720000 |
| fourbit-weights-0060 | [0x3412b355e0faff195c10e456c889a2eb38d52651](https://robinhoodchain.blockscout.com/address/0x3412b355e0faff195c10e456c889a2eb38d52651) | 29,920,669 | 0.000622768804566000 |
| fourbit-weights-0061 | [0x04c9a6ef20764fd78b4ebab17700d58d647d3a03](https://robinhoodchain.blockscout.com/address/0x04c9a6ef20764fd78b4ebab17700d58d647d3a03) | 29,922,084 | 0.000622917944712000 |
| fourbit-weights-0062 | [0x3ad750885f042a9d5190a137f3cec4c3e715878d](https://robinhoodchain.blockscout.com/address/0x3ad750885f042a9d5190a137f3cec4c3e715878d) | 29,924,563 | 0.000622430910400000 |
| fourbit-weights-0063 | [0x7d4adcc0b980407eabac2c30a1253278f84f7e9c](https://robinhoodchain.blockscout.com/address/0x7d4adcc0b980407eabac2c30a1253278f84f7e9c) | 29,921,137 | 0.000626069870588000 |
| fourbit-weights-0064 | [0xd63ed3677dca2e4f2c84d9c1986626a45623efcd](https://robinhoodchain.blockscout.com/address/0xd63ed3677dca2e4f2c84d9c1986626a45623efcd) | 29,920,515 | 0.000625398604530000 |
| fourbit-weights-0065 | [0x14274e93dbe94f0a1a4106e06018449669d9a894](https://robinhoodchain.blockscout.com/address/0x14274e93dbe94f0a1a4106e06018449669d9a894) | 29,923,042 | 0.000626169576892000 |
| fourbit-weights-0066 | [0xdb55b8b723effcde25faad6e257a62e55eeaa6b0](https://robinhoodchain.blockscout.com/address/0xdb55b8b723effcde25faad6e257a62e55eeaa6b0) | 29,921,844 | 0.000622853104704000 |
| fourbit-weights-0067 | [0x0fb3bfe9b08f37013b124f7e4b9311433015aaf4](https://robinhoodchain.blockscout.com/address/0x0fb3bfe9b08f37013b124f7e4b9311433015aaf4) | 29,921,274 | 0.000626431792464000 |
| fourbit-weights-0068 | [0x25ebfb0a31571eba3b9a9ba72b54d6ed041cb7df](https://robinhoodchain.blockscout.com/address/0x25ebfb0a31571eba3b9a9ba72b54d6ed041cb7df) | 29,921,371 | 0.000624159799060000 |
| fourbit-weights-0069 | [0xb9f7ff9b21909324fc9f19d5c099668c3975bf1f](https://robinhoodchain.blockscout.com/address/0xb9f7ff9b21909324fc9f19d5c099668c3975bf1f) | 29,921,898 | 0.000625547199588000 |
| fourbit-weights-0070 | [0xa660769009e7c7c0b895964b565561ad9e677356](https://robinhoodchain.blockscout.com/address/0xa660769009e7c7c0b895964b565561ad9e677356) | 29,921,024 | 0.000626306874368000 |
| fourbit-weights-0071 | [0xc80cf086e72de13bd81b4969d55b3402d732cb0e](https://robinhoodchain.blockscout.com/address/0xc80cf086e72de13bd81b4969d55b3402d732cb0e) | 29,921,122 | 0.000627146717120000 |
| fourbit-weights-0072 | [0x2b1c7bbf053cb94e580d5e3afe1478168f0651a8](https://robinhoodchain.blockscout.com/address/0x2b1c7bbf053cb94e580d5e3afe1478168f0651a8) | 29,920,052 | 0.000634364942504000 |
| fourbit-weights-0073 | [0xdff4bda6adecd355f1d7e8aad2f49becfc8263a8](https://robinhoodchain.blockscout.com/address/0xdff4bda6adecd355f1d7e8aad2f49becfc8263a8) | 29,919,231 | 0.000626089827906000 |
| fourbit-weights-0074 | [0x18386d788de955ab13cd374297b608dd732c7674](https://robinhoodchain.blockscout.com/address/0x18386d788de955ab13cd374297b608dd732c7674) | 29,924,209 | 0.000622902334544000 |
| fourbit-weights-0075 | [0x3cbdf4af046c8a338523b974a557dde9328ec647](https://robinhoodchain.blockscout.com/address/0x3cbdf4af046c8a338523b974a557dde9328ec647) | 29,921,711 | 0.000628774834954000 |
| fourbit-weights-0076 | [0x80df625e29d9e110a525120f4774f681f6276ec3](https://robinhoodchain.blockscout.com/address/0x80df625e29d9e110a525120f4774f681f6276ec3) | 29,921,152 | 0.000623437123072000 |
| fourbit-weights-0077 | [0xe5dafa4c01864a26bdff5d2d00c4c87e51980940](https://robinhoodchain.blockscout.com/address/0xe5dafa4c01864a26bdff5d2d00c4c87e51980940) | 29,920,597 | 0.000624562541778000 |
| fourbit-weights-0078 | [0xf4ccbf9b41d8236b5cabb73b95d4512c9544cbc1](https://robinhoodchain.blockscout.com/address/0xf4ccbf9b41d8236b5cabb73b95d4512c9544cbc1) | 29,921,962 | 0.000621957902132000 |
| fourbit-weights-0079 | [0xfb8db496245070d246d9659aba42b752fc025118](https://robinhoodchain.blockscout.com/address/0xfb8db496245070d246d9659aba42b752fc025118) | 29,921,391 | 0.000650311511994000 |
| fourbit-weights-0080 | [0xd75727ee08f6af42dfe08b5abb0d531f8c779e28](https://robinhoodchain.blockscout.com/address/0xd75727ee08f6af42dfe08b5abb0d531f8c779e28) | 29,921,757 | 0.000626262374010000 |
| fourbit-weights-0081 | [0x1b9d2d1352cb1b50687ed7aebbb657a08d34b6ec](https://robinhoodchain.blockscout.com/address/0x1b9d2d1352cb1b50687ed7aebbb657a08d34b6ec) | 29,921,920 | 0.000625727191040000 |
| fourbit-weights-0082 | [0x864ca5c81c459318e390808f56e6788e3364d4d9](https://robinhoodchain.blockscout.com/address/0x864ca5c81c459318e390808f56e6788e3364d4d9) | 29,920,681 | 0.000626299694692000 |
| fourbit-weights-0083 | [0x0d1185d430526ecd6ae038d61071065d91e450cb](https://robinhoodchain.blockscout.com/address/0x0d1185d430526ecd6ae038d61071065d91e450cb) | 29,921,425 | 0.000627212910850000 |
| fourbit-weights-0084 | [0x04f312f9412795309caf8b31ba46e587ae736e50](https://robinhoodchain.blockscout.com/address/0x04f312f9412795309caf8b31ba46e587ae736e50) | 29,920,888 | 0.000621995419744000 |
| fourbit-weights-0085 | [0x81bef3a8a6f880fab43531baab2aa8fd0d8740b2](https://robinhoodchain.blockscout.com/address/0x81bef3a8a6f880fab43531baab2aa8fd0d8740b2) | 29,925,026 | 0.000623996642152000 |
| fourbit-weights-0086 | [0x28d04ee72f487e41be3d14e3042f2ff0cfb164cc](https://robinhoodchain.blockscout.com/address/0x28d04ee72f487e41be3d14e3042f2ff0cfb164cc) | 29,919,755 | 0.000625502398030000 |
| fourbit-weights-0087 | [0xeb5c7c4394c4e26cea3b60e5f40050231599e4c1](https://robinhoodchain.blockscout.com/address/0xeb5c7c4394c4e26cea3b60e5f40050231599e4c1) | 29,920,773 | 0.000623967800142000 |
| fourbit-weights-0088 | [0x377d64960c518163a65a0cee392fcec9a4436376](https://robinhoodchain.blockscout.com/address/0x377d64960c518163a65a0cee392fcec9a4436376) | 29,919,140 | 0.000622258273720000 |
| fourbit-weights-0089 | [0x6a8f86754d2fc5575d2961c9d6b3288a35954ce1](https://robinhoodchain.blockscout.com/address/0x6a8f86754d2fc5575d2961c9d6b3288a35954ce1) | 29,919,407 | 0.000629923194978000 |
| fourbit-weights-0090 | [0xc8473ea76a22fc9a91740c0d21653b2ab7b32343](https://robinhoodchain.blockscout.com/address/0xc8473ea76a22fc9a91740c0d21653b2ab7b32343) | 30,020,099 | 0.000630542159396000 |
| fourbit-weights-0091 | [0xcc164b5c4931a8ea2fe3dd1edbe19e53a3fb45d2](https://robinhoodchain.blockscout.com/address/0xcc164b5c4931a8ea2fe3dd1edbe19e53a3fb45d2) | 29,923,504 | 0.000627316337856000 |
| fourbit-weights-0092 | [0xb79053307265be791979b8fb986414567fe2a747](https://robinhoodchain.blockscout.com/address/0xb79053307265be791979b8fb986414567fe2a747) | 29,969,108 | 0.000623057755320000 |
| fourbit-weights-0093 | [0xed7be1e8467526e049edb9670e8634362384172b](https://robinhoodchain.blockscout.com/address/0xed7be1e8467526e049edb9670e8634362384172b) | 29,969,157 | 0.000627614085894000 |
| fourbit-weights-0094 | [0x9a7631e3cbd93601c77c976dec5ec27509093fb4](https://robinhoodchain.blockscout.com/address/0x9a7631e3cbd93601c77c976dec5ec27509093fb4) | 29,924,830 | 0.000634286696680000 |
| fourbit-weights-0095 | [0x89b7388851b0ba1e9b237789ee4cedfe3447d046](https://robinhoodchain.blockscout.com/address/0x89b7388851b0ba1e9b237789ee4cedfe3447d046) | 29,575,615 | 0.000617834597350000 |
| fourbit-weights-0096 | [0x249de66cbc4d9e772262ac21597c338b0d118d1f](https://robinhoodchain.blockscout.com/address/0x249de66cbc4d9e772262ac21597c338b0d118d1f) | 29,917,087 | 0.000623531927254000 |
| fourbit-weights-0097 | [0xfc5ff5b718e1e2f61187111e443e960f67dd627a](https://robinhoodchain.blockscout.com/address/0xfc5ff5b718e1e2f61187111e443e960f67dd627a) | 30,102,129 | 0.000634372266546000 |
| fourbit-weights-0098 | [0x18fa757f6819f6d8c9c8d3beada5488a9c590426](https://robinhoodchain.blockscout.com/address/0x18fa757f6819f6d8c9c8d3beada5488a9c590426) | 29,921,505 | 0.000624461809350000 |
| fourbit-weights-0099 | [0xc293347f6aaba6f8d7e71b7d886d0b3ba0f3034c](https://robinhoodchain.blockscout.com/address/0xc293347f6aaba6f8d7e71b7d886d0b3ba0f3034c) | 29,919,735 | 0.000624125672100000 |
| fourbit-weights-0100 | [0x6185ed6512d89f2bb07634375e62d6c3972361f6](https://robinhoodchain.blockscout.com/address/0x6185ed6512d89f2bb07634375e62d6c3972361f6) | 29,923,231 | 0.000622163818952000 |
| fourbit-weights-0101 | [0x1cad7cae7f30e2558c531899759fe1d37fa993ba](https://robinhoodchain.blockscout.com/address/0x1cad7cae7f30e2558c531899759fe1d37fa993ba) | 29,961,577 | 0.000623200801600000 |
| fourbit-weights-0102 | [0x53c54750d26a18a9d9c93f5f559e353b5ee56a6e](https://robinhoodchain.blockscout.com/address/0x53c54750d26a18a9d9c93f5f559e353b5ee56a6e) | 29,943,074 | 0.000624852068232000 |
| fourbit-weights-0103 | [0x79408444af18edbff4abbe4c5f61c19fcfc89ede](https://robinhoodchain.blockscout.com/address/0x79408444af18edbff4abbe4c5f61c19fcfc89ede) | 29,896,098 | 0.000624768656004000 |
| fourbit-weights-0104 | [0x3a9ffc1f27697f17592487b59e51f180dbe29f84](https://robinhoodchain.blockscout.com/address/0x3a9ffc1f27697f17592487b59e51f180dbe29f84) | 29,921,813 | 0.000630931348918000 |
| fourbit-weights-0105 | [0x9a429f55b4946f446d66c6eb4e0f9e48c573c01e](https://robinhoodchain.blockscout.com/address/0x9a429f55b4946f446d66c6eb4e0f9e48c573c01e) | 29,922,236 | 0.000622202975384000 |
| fourbit-weights-0106 | [0x92efcc5666862000e22f2c360ac85091f4a4f838](https://robinhoodchain.blockscout.com/address/0x92efcc5666862000e22f2c360ac85091f4a4f838) | 30,012,723 | 0.000624084562062000 |
| fourbit-weights-0107 | [0xe9f5649093f5726e4d8028a8c3331d702ccebd5f](https://robinhoodchain.blockscout.com/address/0xe9f5649093f5726e4d8028a8c3331d702ccebd5f) | 30,055,913 | 0.000625042766748000 |
| fourbit-weights-0108 | [0xb20e1dc97aa26b097fe4e3ce2c228ae0cb7d9c1f](https://robinhoodchain.blockscout.com/address/0xb20e1dc97aa26b097fe4e3ce2c228ae0cb7d9c1f) | 29,914,980 | 0.000626958150840000 |
| fourbit-weights-0109 | [0x7fdd7dcf2dbf0211fd960be8c2aadc61242a9246](https://robinhoodchain.blockscout.com/address/0x7fdd7dcf2dbf0211fd960be8c2aadc61242a9246) | 30,024,857 | 0.000624517025600000 |
| fourbit-weights-0110 | [0x0af1eb8169861351e5b328a74545a750090219a0](https://robinhoodchain.blockscout.com/address/0x0af1eb8169861351e5b328a74545a750090219a0) | 29,914,110 | 0.000634059475560000 |
| fourbit-weights-0111 | [0x0b974da5681411c9c549d429420e3b28832d5a66](https://robinhoodchain.blockscout.com/address/0x0b974da5681411c9c549d429420e3b28832d5a66) | 29,909,728 | 0.000623019634240000 |
| fourbit-weights-0112 | [0x401ea1f242c6d4d0aec14bd498d3b5fcddfce6ef](https://robinhoodchain.blockscout.com/address/0x401ea1f242c6d4d0aec14bd498d3b5fcddfce6ef) | 29,917,511 | 0.000627609545758000 |
| fourbit-weights-0113 | [0x5874b0ad24dda872fb7b7f0f509e248ed02c42e5](https://robinhoodchain.blockscout.com/address/0x5874b0ad24dda872fb7b7f0f509e248ed02c42e5) | 29,887,876 | 0.000621906923808000 |
| fourbit-weights-0114 | [0x3bfcfbc81b283d20e3ec8f692375c55a57af8ab2](https://robinhoodchain.blockscout.com/address/0x3bfcfbc81b283d20e3ec8f692375c55a57af8ab2) | 30,031,165 | 0.000651075657200000 |
| fourbit-weights-0115 | [0xf435005664bb02a5d314cdddfc075f18e18c4795](https://robinhoodchain.blockscout.com/address/0xf435005664bb02a5d314cdddfc075f18e18c4795) | 29,911,037 | 0.000622149569600000 |
| fourbit-weights-0116 | [0x99e2e1b74b9d66723f7a68fc358bf3dccc881d0e](https://robinhoodchain.blockscout.com/address/0x99e2e1b74b9d66723f7a68fc358bf3dccc881d0e) | 29,911,785 | 0.000626472425040000 |
| fourbit-weights-0117 | [0xa586b79f39c13ceb55c71ee8d6a7290d7b26a451](https://robinhoodchain.blockscout.com/address/0xa586b79f39c13ceb55c71ee8d6a7290d7b26a451) | 29,912,843 | 0.000622246960086000 |
| fourbit-weights-0118 | [0xc56e1f913a42b1ce53dbf8af2cda5103a89d1c71](https://robinhoodchain.blockscout.com/address/0xc56e1f913a42b1ce53dbf8af2cda5103a89d1c71) | 30,009,803 | 0.000638428549022000 |
| fourbit-weights-0119 | [0xc7a70cdb03103141e135cd68fa6289e0b406e4df](https://robinhoodchain.blockscout.com/address/0xc7a70cdb03103141e135cd68fa6289e0b406e4df) | 29,888,555 | 0.000638060872140000 |
| fourbit-weights-0120 | [0x1ba0e059f0123ed076eb21e430ac9155f753a824](https://robinhoodchain.blockscout.com/address/0x1ba0e059f0123ed076eb21e430ac9155f753a824) | 29,673,235 | 0.000640111025420000 |
| fourbit-weights-0121 | [0xd0881fb30658075b140229bd1010f93492acfa6b](https://robinhoodchain.blockscout.com/address/0xd0881fb30658075b140229bd1010f93492acfa6b) | 29,912,797 | 0.000667773280228000 |
| fourbit-weights-0122 | [0xc4d58d918977995d6cc1de1a9ae7d216f4c84467](https://robinhoodchain.blockscout.com/address/0xc4d58d918977995d6cc1de1a9ae7d216f4c84467) | 29,919,538 | 0.000625856895884000 |
| fourbit-weights-0123 | [0x60e04c9c3caa3fe878b338a6f684448a961a33b1](https://robinhoodchain.blockscout.com/address/0x60e04c9c3caa3fe878b338a6f684448a961a33b1) | 29,869,444 | 0.000648525368128000 |
| fourbit-weights-0124 | [0x7a2495497d458f1e1d57225f1f6150f920b2a86e](https://robinhoodchain.blockscout.com/address/0x7a2495497d458f1e1d57225f1f6150f920b2a86e) | 30,089,255 | 0.000628083108870000 |
| fourbit-weights-0125 | [0xf607a7987bee21784968084df23d08462b8c85e5](https://robinhoodchain.blockscout.com/address/0xf607a7987bee21784968084df23d08462b8c85e5) | 29,912,251 | 0.000622713241318000 |
| fourbit-weights-0126 | [0x575d07f6ad8f331a41c77edb789760e717c45497](https://robinhoodchain.blockscout.com/address/0x575d07f6ad8f331a41c77edb789760e717c45497) | 30,019,057 | 0.000630400197000000 |
| fourbit-weights-0127 | [0x1c5f0def8c8a53095e53dd70a70c56445d20a4bd](https://robinhoodchain.blockscout.com/address/0x1c5f0def8c8a53095e53dd70a70c56445d20a4bd) | 29,912,604 | 0.000625592200056000 |
| fourbit-weights-0128 | [0x0015f2cee396e12ba2d14deee3b86ea359a25637](https://robinhoodchain.blockscout.com/address/0x0015f2cee396e12ba2d14deee3b86ea359a25637) | 29,985,872 | 0.000624605713760000 |
| fourbit-weights-0129 | [0x8ece96a0202d2bae52903fbdf1d7671e95816a0a](https://robinhoodchain.blockscout.com/address/0x8ece96a0202d2bae52903fbdf1d7671e95816a0a) | 29,926,002 | 0.000630840122160000 |
| fourbit-weights-0130 | [0x16a26526ed23fd4c5c379e7a9ca3514dea63a22e](https://robinhoodchain.blockscout.com/address/0x16a26526ed23fd4c5c379e7a9ca3514dea63a22e) | 30,065,540 | 0.000627407688720000 |
| fourbit-weights-0131 | [0xbb09aecd34c4d350372677268ca5545bcb815bd9](https://robinhoodchain.blockscout.com/address/0xbb09aecd34c4d350372677268ca5545bcb815bd9) | 29,941,248 | 0.000650683201536000 |
| fourbit-weights-0132 | [0x65a6ebe5a1c10a8880a3a6b089e0f28ad65a0642](https://robinhoodchain.blockscout.com/address/0x65a6ebe5a1c10a8880a3a6b089e0f28ad65a0642) | 29,906,526 | 0.000622294993008000 |
| fourbit-weights-0133 | [0xb6700673a2035ce2a5be27c99db6af327e5869aa](https://robinhoodchain.blockscout.com/address/0xb6700673a2035ce2a5be27c99db6af327e5869aa) | 29,912,547 | 0.000635103197904000 |
| fourbit-weights-0134 | [0x466ddaebfe9796864c19580f65342e7f110eba34](https://robinhoodchain.blockscout.com/address/0x466ddaebfe9796864c19580f65342e7f110eba34) | 29,915,478 | 0.000624635180640000 |
| fourbit-weights-0135 | [0x9d37ab1d209af885ccdc05692dde666828ea2481](https://robinhoodchain.blockscout.com/address/0x9d37ab1d209af885ccdc05692dde666828ea2481) | 30,012,848 | 0.000648697696672000 |
| fourbit-weights-0136 | [0x6e505f4710fb19cb9a2d87f0b6cd9c137a01734c](https://robinhoodchain.blockscout.com/address/0x6e505f4710fb19cb9a2d87f0b6cd9c137a01734c) | 29,885,978 | 0.000621867430224000 |
| fourbit-weights-0137 | [0xdc313ec18af3a568437627f7f9c7eda7b278e8e1](https://robinhoodchain.blockscout.com/address/0xdc313ec18af3a568437627f7f9c7eda7b278e8e1) | 30,000,412 | 0.000624248572896000 |
| fourbit-weights-0138 | [0x7e31845e83525bde73d3a0101caf34a281880e4e](https://robinhoodchain.blockscout.com/address/0x7e31845e83525bde73d3a0101caf34a281880e4e) | 29,915,538 | 0.000624815926668000 |
| fourbit-weights-0139 | [0x457f60ba148af6370f18f6ecf32044020ccf6b09](https://robinhoodchain.blockscout.com/address/0x457f60ba148af6370f18f6ecf32044020ccf6b09) | 30,215,840 | 0.000632175804480000 |
| fourbit-weights-0140 | [0xfead4d801052a2752e479b74067f4519167db43d](https://robinhoodchain.blockscout.com/address/0xfead4d801052a2752e479b74067f4519167db43d) | 29,919,555 | 0.000652485655440000 |
| fourbit-weights-0141 | [0x9873d9843ad008642473c8f117e7eb22bb30fbde](https://robinhoodchain.blockscout.com/address/0x9873d9843ad008642473c8f117e7eb22bb30fbde) | 30,096,421 | 0.000627570570692000 |
| fourbit-weights-0142 | [0x2cab02ce4b9210aa40ce36e177af096c76b49a79](https://robinhoodchain.blockscout.com/address/0x2cab02ce4b9210aa40ce36e177af096c76b49a79) | 29,915,065 | 0.000626900102140000 |
| fourbit-weights-0143 | [0xb917e3c34e3b2910fbd9a28f3f9c3384ee37b322](https://robinhoodchain.blockscout.com/address/0xb917e3c34e3b2910fbd9a28f3f9c3384ee37b322) | 30,017,804 | 0.000627312067992000 |
| fourbit-weights-0144 | [0xc9b08b2cf765b1f120cb88fddb56e58a6fc10bc8](https://robinhoodchain.blockscout.com/address/0xc9b08b2cf765b1f120cb88fddb56e58a6fc10bc8) | 29,915,380 | 0.000631094856480000 |
| fourbit-weights-0145 | [0xdb19b31f69911336e39a7cfd028f9bc8133797a7](https://robinhoodchain.blockscout.com/address/0xdb19b31f69911336e39a7cfd028f9bc8133797a7) | 29,989,200 | 0.000625514733600000 |
| fourbit-weights-0146 | [0xcc9e4037a683a95f28fd778570685e20e3757083](https://robinhoodchain.blockscout.com/address/0xcc9e4037a683a95f28fd778570685e20e3757083) | 29,918,963 | 0.000628657250556000 |
| fourbit-weights-0147 | [0x6d662d7fc1a95fd4c0cdfefd17baf6bbc832e670](https://robinhoodchain.blockscout.com/address/0x6d662d7fc1a95fd4c0cdfefd17baf6bbc832e670) | 30,046,222 | 0.000657411337360000 |
| fourbit-weights-0148 | [0x1106c4001621595af5f64ca377769c24b2feb543](https://robinhoodchain.blockscout.com/address/0x1106c4001621595af5f64ca377769c24b2feb543) | 29,941,426 | 0.000646914450156000 |
| fourbit-weights-0149 | [0x12104bd36afd097007e7c67deffa44e62010289a](https://robinhoodchain.blockscout.com/address/0x12104bd36afd097007e7c67deffa44e62010289a) | 29,907,939 | 0.000625733899758000 |
| fourbit-weights-0150 | [0xf17b70458966ac31379ce5b54da2f4b6c084e7bf](https://robinhoodchain.blockscout.com/address/0xf17b70458966ac31379ce5b54da2f4b6c084e7bf) | 29,907,902 | 0.000632193232476000 |
| fourbit-weights-0151 | [0x3ad257446a569876e740a2af01db2f5118198818](https://robinhoodchain.blockscout.com/address/0x3ad257446a569876e740a2af01db2f5118198818) | 29,909,948 | 0.000652874344944000 |
| fourbit-weights-0152 | [0xb261f3951dccf7dccba9a4bbd9d0af6de778d396](https://robinhoodchain.blockscout.com/address/0xb261f3951dccf7dccba9a4bbd9d0af6de778d396) | 30,000,372 | 0.000655088122992000 |
| fourbit-weights-0153 | [0xc861c6d48fd92126ff4f7cbddd9b914d5f8e8277](https://robinhoodchain.blockscout.com/address/0xc861c6d48fd92126ff4f7cbddd9b914d5f8e8277) | 29,880,682 | 0.000628689549280000 |
| fourbit-weights-0154 | [0x2419900bec189b6d2df174458577215e5b81241b](https://robinhoodchain.blockscout.com/address/0x2419900bec189b6d2df174458577215e5b81241b) | 30,011,117 | 0.000628252723278000 |
| fourbit-weights-0155 | [0x07c71e0621733dcbe22f296bbf76f84bbeb99626](https://robinhoodchain.blockscout.com/address/0x07c71e0621733dcbe22f296bbf76f84bbeb99626) | 29,758,589 | 0.000626358781272000 |
| fourbit-weights-0156 | [0x92c84c9cfa9479a39a8728aedcefaf69401532db](https://robinhoodchain.blockscout.com/address/0x92c84c9cfa9479a39a8728aedcefaf69401532db) | 30,125,584 | 0.000635890827072000 |
| fourbit-weights-0157 | [0x81281aab07e3b9c8dd6cbb46e889bb55a2864f42](https://robinhoodchain.blockscout.com/address/0x81281aab07e3b9c8dd6cbb46e889bb55a2864f42) | 29,918,505 | 0.000623022948120000 |
| fourbit-weights-0158 | [0x516b2679cfea6d919655dd098ce435fdf41e5901](https://robinhoodchain.blockscout.com/address/0x516b2679cfea6d919655dd098ce435fdf41e5901) | 30,106,239 | 0.000626932320936000 |
| fourbit-weights-0159 | [0x6249379928be0dfc6f8be66de8918889c633b835](https://robinhoodchain.blockscout.com/address/0x6249379928be0dfc6f8be66de8918889c633b835) | 29,913,050 | 0.000628951789300000 |
| fourbit-weights-0160 | [0x59fbdfd13528e0ea1b38779846145452fc873d10](https://robinhoodchain.blockscout.com/address/0x59fbdfd13528e0ea1b38779846145452fc873d10) | 30,010,468 | 0.000639523073080000 |
| fourbit-weights-0161 | [0x76b6938b7a0460d1df72ea5f03e2a168d2d4e263](https://robinhoodchain.blockscout.com/address/0x76b6938b7a0460d1df72ea5f03e2a168d2d4e263) | 29,913,813 | 0.000622985069538000 |
| fourbit-weights-0162 | [0xcf19113332839068389e14acc87d62aa04106f22](https://robinhoodchain.blockscout.com/address/0xcf19113332839068389e14acc87d62aa04106f22) | 29,997,716 | 0.000630431999456000 |
| fourbit-weights-0163 | [0x3bfb4c89079c98f3c39c50b9488bacfc6a42a1c0](https://robinhoodchain.blockscout.com/address/0x3bfb4c89079c98f3c39c50b9488bacfc6a42a1c0) | 29,913,487 | 0.000660429965986000 |
| fourbit-weights-0164 | [0x85842169798c74d9ffaa7aab4f48f52eb4574b30](https://robinhoodchain.blockscout.com/address/0x85842169798c74d9ffaa7aab4f48f52eb4574b30) | 30,070,476 | 0.000643207481640000 |
| fourbit-weights-0165 | [0x057fdf7c030a815dcb40b31ae37e6c1887c2d73a](https://robinhoodchain.blockscout.com/address/0x057fdf7c030a815dcb40b31ae37e6c1887c2d73a) | 29,903,678 | 0.000637247378180000 |
| fourbit-weights-0166 | [0xc8901b46487e38aca9f64e73470a3d1ae5a19aff](https://robinhoodchain.blockscout.com/address/0xc8901b46487e38aca9f64e73470a3d1ae5a19aff) | 29,905,134 | 0.000633211307316000 |
| fourbit-weights-0167 | [0x2f55761f6d766a4b1347d093c9f6fe04ffee92a5](https://robinhoodchain.blockscout.com/address/0x2f55761f6d766a4b1347d093c9f6fe04ffee92a5) | 29,904,448 | 0.000627335510144000 |
| fourbit-weights-0168 | [0xc57934b689a95726f3220b7f3f3b6a03f912022b](https://robinhoodchain.blockscout.com/address/0xc57934b689a95726f3220b7f3f3b6a03f912022b) | 29,908,480 | 0.000624249794560000 |
| fourbit-weights-0169 | [0x042a9a673aa998e86fed1684444b9df9f6687fbb](https://robinhoodchain.blockscout.com/address/0x042a9a673aa998e86fed1684444b9df9f6687fbb) | 29,982,708 | 0.000635153686272000 |
| fourbit-weights-0170 | [0x26292383d806e6a9c56cd89e339f158d3e6403b2](https://robinhoodchain.blockscout.com/address/0x26292383d806e6a9c56cd89e339f158d3e6403b2) | 29,872,443 | 0.000636223291014000 |
| fourbit-weights-0171 | [0x567248ae0865019ee593e72ac272a9f87d2b552c](https://robinhoodchain.blockscout.com/address/0x567248ae0865019ee593e72ac272a9f87d2b552c) | 30,008,060 | 0.000632869985400000 |
| fourbit-weights-0172 | [0xb4abe49c690e10d442a26ec62a6ae87c04b2d5b6](https://robinhoodchain.blockscout.com/address/0xb4abe49c690e10d442a26ec62a6ae87c04b2d5b6) | 30,013,271 | 0.000627997682404000 |
| fourbit-weights-0173 | [0xcfa7e5121482137e7b69b6f0d4626a974f1472ac](https://robinhoodchain.blockscout.com/address/0xcfa7e5121482137e7b69b6f0d4626a974f1472ac) | 30,131,358 | 0.000636615331824000 |
