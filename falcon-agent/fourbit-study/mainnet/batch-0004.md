# GH0ST four-bit RH deployment batch

Status: stage_complete_paused

This invocation verified 122 contracts; 4,000,758,321 gas; 0.084967911586284000 ETH.

Transactions are independent; HTTP bundling is not atomic and does not itself reduce chain gas.

| Measure | Value |
|---|---:|
| Four-bit contracts complete / planned | 497 / 497 |
| Old six-bit contracts retained | 2 |
| Wallet balance | 0.010509448211852451 ETH |
| Four-bit contracts remaining | 0 |
| Estimated remaining gas | 0 |
| Estimated remaining fee at snapshot price | 0.000000000000000000 ETH |
| Next batch quoted maximum | 0.000000000000000000 ETH |
| Reserve | 0.002000000000000000 ETH |
| Suggested top-up for next batch | 0.000000000000000000 ETH |

Snapshot (UTC): 2026-10-20T16:34:48.107599+00:00
Local Cancun execution gas calibrated by live total estimates/receipts including parent posting; RH prices may change. Index gas provisional.

No automatic next batch. RH receipts are not a claim of Ethereum finality.
Scope: immutable weights, matrix kernel and final index. Full inference is not implemented.

The final authorized review batch is complete: **122 contracts**, comprising weight shards 0374–0494 and the final immutable address index. All 495 weight receipts and exact runtimes were verified before creating the index. The index was also deployed locally using the actual shard addresses and its complete runtime bytes checked before mainnet deployment.

The four-bit stage is complete: **497 verified contracts** (one matrix kernel, 495 weight contracts, one index), or **499 including the two historical six-bit pilots**. There are no remaining contracts in this stage and no unresolved transactions. Latest/pending nonce: 499/499.

Final index: [0x4a5aaa46e02b8cbd3fa2c39802a3e8339c98ada0](https://robinhoodchain.blockscout.com/address/0x4a5aaa46e02b8cbd3fa2c39802a3e8339c98ada0). Its 9,949-byte runtime contains the G4IX header, 98,303-byte shard payload size, 48,626,528-byte file length, pinned model SHA-256 and all 495 shard addresses in file order. Index runtime Keccak: `0x837bbe58f9d52bb20e8198019a10b97e706aab9cb9e400ca229b6d1cb390c307`.

This batch used 4,000,758,321 gas: 3,611,313,498 execution and 389,444,823 parent posting. Actual fees were 0.084967911586284000 ETH, including 0.008264250877142000 ETH for parent posting. Wallet opening balance was 0.095456932662955787 ETH and closing balance 0.010509448211852451 ETH. Net external balance additions were 0.000020427135180664 ETH (closing minus opening plus actual receipt fees).

The full four-bit stage used 15,338,014,634 gas and 0.324359492033248000 ETH. Including the historical pilots, actual totals are 15,352,086,000 gas and 0.324643352822976000 ETH. All 497 stage receipts and complete runtime bytes were checked again after completion.

This completes the immutable weights, matrix kernel and index deployment. **Full on-chain inference and the complete agent runtime remain unimplemented.** No additional deployment or inference transaction starts automatically.

[Exact receipts](batch-0004.json) · [Complete deployment journal](deployment-state.json) · [Address manifest](deployment-manifest.json) · [Final reconciliation](batch-0004-reconciliation.json) · [Local index validation](batch-0004-index-local-validation.json) · [Validation source](batch-0004-validate-index.py)

## Verified contracts

| Contract | Address | Gas | Fee (ETH) |
|---|---|---:|---:|
| fourbit-weights-0374 | [0x3c0bd05974aa25792255a615cd730b0ff54a26e5](https://robinhoodchain.blockscout.com/address/0x3c0bd05974aa25792255a615cd730b0ff54a26e5) | 30,163,640 | 0.000632229894400000 |
| fourbit-weights-0375 | [0xc1d73a066bbaa52e4b0fd938ed433235986ae184](https://robinhoodchain.blockscout.com/address/0xc1d73a066bbaa52e4b0fd938ed433235986ae184) | 30,271,650 | 0.000640729743900000 |
| fourbit-weights-0376 | [0x4b74c0a39129539af46f2c2249ce2fe6a0fd61cd](https://robinhoodchain.blockscout.com/address/0x4b74c0a39129539af46f2c2249ce2fe6a0fd61cd) | 30,000,973 | 0.000638240699602000 |
| fourbit-weights-0377 | [0x857e785e939715a71ff9ef19dbb918a370194ec2](https://robinhoodchain.blockscout.com/address/0x857e785e939715a71ff9ef19dbb918a370194ec2) | 30,061,128 | 0.000630742587696000 |
| fourbit-weights-0378 | [0xf9f6684de6c5ccfdacef93a3e052abdac3742e7d](https://robinhoodchain.blockscout.com/address/0xf9f6684de6c5ccfdacef93a3e052abdac3742e7d) | 30,056,618 | 0.000633773847148000 |
| fourbit-weights-0379 | [0xc32a57d36bf63fad78254f9c07fc493efab01c48](https://robinhoodchain.blockscout.com/address/0xc32a57d36bf63fad78254f9c07fc493efab01c48) | 30,100,476 | 0.000656491381560000 |
| fourbit-weights-0380 | [0x60a0cda2a40c491b0c6c64d8beb8638a51f55152](https://robinhoodchain.blockscout.com/address/0x60a0cda2a40c491b0c6c64d8beb8638a51f55152) | 30,054,928 | 0.000655197430400000 |
| fourbit-weights-0381 | [0x229852813b45a6b27a6b6416f156d234a697f890](https://robinhoodchain.blockscout.com/address/0x229852813b45a6b27a6b6416f156d234a697f890) | 30,153,001 | 0.000634177917032000 |
| fourbit-weights-0382 | [0xd92505a929edabf4f47d0a15077aae3f93ee2a24](https://robinhoodchain.blockscout.com/address/0xd92505a929edabf4f47d0a15077aae3f93ee2a24) | 30,064,424 | 0.000641214035072000 |
| fourbit-weights-0383 | [0xac7aad517b8668e448c475703236095566df5631](https://robinhoodchain.blockscout.com/address/0xac7aad517b8668e448c475703236095566df5631) | 30,223,651 | 0.000633548172262000 |
| fourbit-weights-0384 | [0x95135791473b1c5cedf2053098cec38641188029](https://robinhoodchain.blockscout.com/address/0x95135791473b1c5cedf2053098cec38641188029) | 30,064,458 | 0.000632315680656000 |
| fourbit-weights-0385 | [0x431353fe23c009a6b18e6ecad76d17f66efb1c4b](https://robinhoodchain.blockscout.com/address/0x431353fe23c009a6b18e6ecad76d17f66efb1c4b) | 30,063,674 | 0.000630796007868000 |
| fourbit-weights-0386 | [0x83318e16951bbfd99e5fe58360290d74d24b121a](https://robinhoodchain.blockscout.com/address/0x83318e16951bbfd99e5fe58360290d74d24b121a) | 30,056,744 | 0.000641230576496000 |
| fourbit-weights-0387 | [0xae32c0e5eb4ad305e4418f9735c9d1bea5784797](https://robinhoodchain.blockscout.com/address/0xae32c0e5eb4ad305e4418f9735c9d1bea5784797) | 30,038,243 | 0.000632845703524000 |
| fourbit-weights-0388 | [0x999bd5e0622e87d30a922827206677d39bb9c3a0](https://robinhoodchain.blockscout.com/address/0x999bd5e0622e87d30a922827206677d39bb9c3a0) | 30,080,477 | 0.000630607119828000 |
| fourbit-weights-0389 | [0x622aec9c3013892cbe9ebb85a3ae4bb67d818890](https://robinhoodchain.blockscout.com/address/0x622aec9c3013892cbe9ebb85a3ae4bb67d818890) | 30,030,209 | 0.000647811668548000 |
| fourbit-weights-0390 | [0xf6c3a41df27883f6e118bc0afeb04c72fb2285a7](https://robinhoodchain.blockscout.com/address/0xf6c3a41df27883f6e118bc0afeb04c72fb2285a7) | 30,171,076 | 0.000635101149800000 |
| fourbit-weights-0391 | [0x470ef32683be6ed3c007d98ea78eda8478a1bbd2](https://robinhoodchain.blockscout.com/address/0x470ef32683be6ed3c007d98ea78eda8478a1bbd2) | 30,063,494 | 0.000654662645344000 |
| fourbit-weights-0392 | [0xc1910b2013a69a1289b80b968b80ca51eb4bbc6f](https://robinhoodchain.blockscout.com/address/0xc1910b2013a69a1289b80b968b80ca51eb4bbc6f) | 30,158,149 | 0.000680307525142000 |
| fourbit-weights-0393 | [0x1bb21d1a0b6cbce841b463252c099bf6fc75584d](https://robinhoodchain.blockscout.com/address/0x1bb21d1a0b6cbce841b463252c099bf6fc75584d) | 30,213,618 | 0.000664337032584000 |
| fourbit-weights-0394 | [0xf8868890f24043e9e85c3147fc89f311a697dcea](https://robinhoodchain.blockscout.com/address/0xf8868890f24043e9e85c3147fc89f311a697dcea) | 30,062,853 | 0.000633724941240000 |
| fourbit-weights-0395 | [0x154ab352cb07d82ff0aabdcedc97a9bfe0362575](https://robinhoodchain.blockscout.com/address/0x154ab352cb07d82ff0aabdcedc97a9bfe0362575) | 30,174,200 | 0.000637761891200000 |
| fourbit-weights-0396 | [0xbf700af73f23c1bcca7cb69cd81cd9b09329af73](https://robinhoodchain.blockscout.com/address/0xbf700af73f23c1bcca7cb69cd81cd9b09329af73) | 30,064,415 | 0.000633938254690000 |
| fourbit-weights-0397 | [0x65dbc82e91f2c47c1edd3ede736eadff13fa3159](https://robinhoodchain.blockscout.com/address/0x65dbc82e91f2c47c1edd3ede736eadff13fa3159) | 30,094,439 | 0.000631080385830000 |
| fourbit-weights-0398 | [0x904df320e726c9f31577783cb600f5ca1007b7c4](https://robinhoodchain.blockscout.com/address/0x904df320e726c9f31577783cb600f5ca1007b7c4) | 30,094,831 | 0.000632593347620000 |
| fourbit-weights-0399 | [0xbc3ea018c4a5fc68fe42080b59213fc3bb86e963](https://robinhoodchain.blockscout.com/address/0xbc3ea018c4a5fc68fe42080b59213fc3bb86e963) | 30,064,745 | 0.000632862882250000 |
| fourbit-weights-0400 | [0xbf61b5bd447ea98d1ed1c35eb944f372bb91240d](https://robinhoodchain.blockscout.com/address/0xbf61b5bd447ea98d1ed1c35eb944f372bb91240d) | 30,241,719 | 0.000637918820586000 |
| fourbit-weights-0401 | [0xd1bdda786566de2c89976489692892054f79128f](https://robinhoodchain.blockscout.com/address/0xd1bdda786566de2c89976489692892054f79128f) | 30,060,843 | 0.000637410114972000 |
| fourbit-weights-0402 | [0x05c77574b4ee20900242313c67c921a65fee2a19](https://robinhoodchain.blockscout.com/address/0x05c77574b4ee20900242313c67c921a65fee2a19) | 30,061,399 | 0.000636640308022000 |
| fourbit-weights-0403 | [0x139da0c5dfd00656bc66369651cd2f55b8dbd186](https://robinhoodchain.blockscout.com/address/0x139da0c5dfd00656bc66369651cd2f55b8dbd186) | 30,059,495 | 0.000637561888950000 |
| fourbit-weights-0404 | [0x6258dff71344d9df83eda8acd75834dd34386e72](https://robinhoodchain.blockscout.com/address/0x6258dff71344d9df83eda8acd75834dd34386e72) | 30,152,736 | 0.000639418919616000 |
| fourbit-weights-0405 | [0x3985db7291c1834375e9191e6e2014f0e1342824](https://robinhoodchain.blockscout.com/address/0x3985db7291c1834375e9191e6e2014f0e1342824) | 30,031,180 | 0.000630174281120000 |
| fourbit-weights-0406 | [0x66c23ee70381e3ac6522aff942c3a5959446e2be](https://robinhoodchain.blockscout.com/address/0x66c23ee70381e3ac6522aff942c3a5959446e2be) | 30,084,281 | 0.000635380014720000 |
| fourbit-weights-0407 | [0x4347b5ae5a5c14b0bf2c580fd28a9f73901e09e3](https://robinhoodchain.blockscout.com/address/0x4347b5ae5a5c14b0bf2c580fd28a9f73901e09e3) | 30,113,449 | 0.000639730110556000 |
| fourbit-weights-0408 | [0xc6633282515733b64bc2696f9f27bbea95360642](https://robinhoodchain.blockscout.com/address/0xc6633282515733b64bc2696f9f27bbea95360642) | 30,057,806 | 0.000646002366552000 |
| fourbit-weights-0409 | [0x636424babe14090e9a1e8fb11185333555d77e0c](https://robinhoodchain.blockscout.com/address/0x636424babe14090e9a1e8fb11185333555d77e0c) | 30,178,011 | 0.000635669623704000 |
| fourbit-weights-0410 | [0x0d861a16eaf724ecd5d0b9fad610df3c9d88f542](https://robinhoodchain.blockscout.com/address/0x0d861a16eaf724ecd5d0b9fad610df3c9d88f542) | 30,217,850 | 0.000638926220400000 |
| fourbit-weights-0411 | [0xda687317984b849d77122ee576f5f219d28a9c7a](https://robinhoodchain.blockscout.com/address/0xda687317984b849d77122ee576f5f219d28a9c7a) | 30,061,537 | 0.000635861630624000 |
| fourbit-weights-0412 | [0x84462be42a7716836025eeaac4031eb6ad20e929](https://robinhoodchain.blockscout.com/address/0x84462be42a7716836025eeaac4031eb6ad20e929) | 30,175,166 | 0.000633074982680000 |
| fourbit-weights-0413 | [0xea9dc5780bcb583b2f5a7352f4cb0a69bbfc70eb](https://robinhoodchain.blockscout.com/address/0xea9dc5780bcb583b2f5a7352f4cb0a69bbfc70eb) | 30,061,849 | 0.000631719694886000 |
| fourbit-weights-0414 | [0x4016de50c697508eb0e04db67cec6b36bbd5b9c6](https://robinhoodchain.blockscout.com/address/0x4016de50c697508eb0e04db67cec6b36bbd5b9c6) | 30,146,032 | 0.000636985656160000 |
| fourbit-weights-0415 | [0xa4c5ac2d15faa93cfbdac152b334922d466c6785](https://robinhoodchain.blockscout.com/address/0xa4c5ac2d15faa93cfbdac152b334922d466c6785) | 30,060,349 | 0.000630545880624000 |
| fourbit-weights-0416 | [0x2e5e4abf3590cec42688f0662e369c0b928d0797](https://robinhoodchain.blockscout.com/address/0x2e5e4abf3590cec42688f0662e369c0b928d0797) | 30,186,577 | 0.000679499848270000 |
| fourbit-weights-0417 | [0x51e9d228ca490ffce1effe23f641711bc15a2794](https://robinhoodchain.blockscout.com/address/0x51e9d228ca490ffce1effe23f641711bc15a2794) | 30,054,290 | 0.000677063045120000 |
| fourbit-weights-0418 | [0x81c887650a21d64d436b7d9ebaeeaa59e4896574](https://robinhoodchain.blockscout.com/address/0x81c887650a21d64d436b7d9ebaeeaa59e4896574) | 30,058,409 | 0.000653349578024000 |
| fourbit-weights-0419 | [0x0c0123cff22fd22f248a7996b9b5d7c22e11f330](https://robinhoodchain.blockscout.com/address/0x0c0123cff22fd22f248a7996b9b5d7c22e11f330) | 30,064,966 | 0.000630702856748000 |
| fourbit-weights-0420 | [0xeb108ac28f0bf632670b1f620c7c961590df9a16](https://robinhoodchain.blockscout.com/address/0xeb108ac28f0bf632670b1f620c7c961590df9a16) | 30,059,270 | 0.000636655338600000 |
| fourbit-weights-0421 | [0xa53dc5a7a17f0513f2a2ca71b93561c250e7bb4e](https://robinhoodchain.blockscout.com/address/0xa53dc5a7a17f0513f2a2ca71b93561c250e7bb4e) | 30,146,321 | 0.000632409521938000 |
| fourbit-weights-0422 | [0x1239690b3c930343563019b42323b43ea375e814](https://robinhoodchain.blockscout.com/address/0x1239690b3c930343563019b42323b43ea375e814) | 30,036,366 | 0.000633226668012000 |
| fourbit-weights-0423 | [0x8bac6780b7c74f3b5256c3aacc0dd97771a9a556](https://robinhoodchain.blockscout.com/address/0x8bac6780b7c74f3b5256c3aacc0dd97771a9a556) | 30,153,907 | 0.000634498511094000 |
| fourbit-weights-0424 | [0x788f01d880686e8305f877661a58bacbd126c0f8](https://robinhoodchain.blockscout.com/address/0x788f01d880686e8305f877661a58bacbd126c0f8) | 30,066,939 | 0.000633570538608000 |
| fourbit-weights-0425 | [0xa3428689edec0bbf8db8576497c9fc9f843536a6](https://robinhoodchain.blockscout.com/address/0xa3428689edec0bbf8db8576497c9fc9f843536a6) | 29,963,809 | 0.000629180061382000 |
| fourbit-weights-0426 | [0x012a8bddd3333690d623501b9751d69c3d2e080e](https://robinhoodchain.blockscout.com/address/0x012a8bddd3333690d623501b9751d69c3d2e080e) | 35,565,117 | 0.000746867457000000 |
| fourbit-weights-0427 | [0xac9706faa369df229d90564c53935bf184d5fd0e](https://robinhoodchain.blockscout.com/address/0xac9706faa369df229d90564c53935bf184d5fd0e) | 35,606,370 | 0.000750368641380000 |
| fourbit-weights-0428 | [0xa7a117a8ede11c122938e99c235d6bda7c327783](https://robinhoodchain.blockscout.com/address/0xa7a117a8ede11c122938e99c235d6bda7c327783) | 35,568,151 | 0.000746219807980000 |
| fourbit-weights-0429 | [0x80a0dcdb73aa9b066596be4da8cd88da49032df0](https://robinhoodchain.blockscout.com/address/0x80a0dcdb73aa9b066596be4da8cd88da49032df0) | 35,638,657 | 0.000751476721502000 |
| fourbit-weights-0430 | [0x8084aeba700f8c8f402e20d205e82fd8c7256ca3](https://robinhoodchain.blockscout.com/address/0x8084aeba700f8c8f402e20d205e82fd8c7256ca3) | 35,570,539 | 0.000746269908220000 |
| fourbit-weights-0431 | [0xef265f1d1c23b94d624344a3662941f3cd1578f3](https://robinhoodchain.blockscout.com/address/0xef265f1d1c23b94d624344a3662941f3cd1578f3) | 35,409,012 | 0.000770570919144000 |
| fourbit-weights-0432 | [0x5cee1b85ff2229cef23a3969660d3790090108d1](https://robinhoodchain.blockscout.com/address/0x5cee1b85ff2229cef23a3969660d3790090108d1) | 35,159,867 | 0.000792503402180000 |
| fourbit-weights-0433 | [0x7ffc8f176d15c6471f87bb22c9afbc7ec6f1b524](https://robinhoodchain.blockscout.com/address/0x7ffc8f176d15c6471f87bb22c9afbc7ec6f1b524) | 35,284,236 | 0.000774347843256000 |
| fourbit-weights-0434 | [0xf360d00357036b23b1ee569e9690f744f62ad174](https://robinhoodchain.blockscout.com/address/0xf360d00357036b23b1ee569e9690f744f62ad174) | 35,504,838 | 0.000749436120504000 |
| fourbit-weights-0435 | [0xfb2e89678149b1580b2046dbc164607ca36d0fd2](https://robinhoodchain.blockscout.com/address/0xfb2e89678149b1580b2046dbc164607ca36d0fd2) | 35,548,388 | 0.000748577954504000 |
| fourbit-weights-0436 | [0xc3ed8a32578d983436cb3a115eb7676e613ed303](https://robinhoodchain.blockscout.com/address/0xc3ed8a32578d983436cb3a115eb7676e613ed303) | 35,539,534 | 0.000747822874428000 |
| fourbit-weights-0437 | [0xba9b5dae7bcea4230f0289c2453dd67824e4b3e9](https://robinhoodchain.blockscout.com/address/0xba9b5dae7bcea4230f0289c2453dd67824e4b3e9) | 35,570,964 | 0.000746349966648000 |
| fourbit-weights-0438 | [0xbda410dbc8b88a05395562a60f5048d59e31454b](https://robinhoodchain.blockscout.com/address/0xbda410dbc8b88a05395562a60f5048d59e31454b) | 35,520,959 | 0.000751197240932000 |
| fourbit-weights-0439 | [0xb97d27b49bcf14bff9ba0f67700556d38a3e1361](https://robinhoodchain.blockscout.com/address/0xb97d27b49bcf14bff9ba0f67700556d38a3e1361) | 35,462,141 | 0.000744066642462000 |
| fourbit-weights-0440 | [0xdb45780eb82287bf12679f36c27e43e9630f2322](https://robinhoodchain.blockscout.com/address/0xdb45780eb82287bf12679f36c27e43e9630f2322) | 35,381,337 | 0.000771454671948000 |
| fourbit-weights-0441 | [0xf7d47a0bc35e6f17d0aa4a58247cbcab7ace3bd2](https://robinhoodchain.blockscout.com/address/0xf7d47a0bc35e6f17d0aa4a58247cbcab7ace3bd2) | 35,556,438 | 0.000748463019900000 |
| fourbit-weights-0442 | [0xd400bd805e0f05f2a07aa010f61bbde2269ee4bd](https://robinhoodchain.blockscout.com/address/0xd400bd805e0f05f2a07aa010f61bbde2269ee4bd) | 35,350,040 | 0.000750552049280000 |
| fourbit-weights-0443 | [0x776993ff384098a01d45cbe8e46f5a07c2348dc3](https://robinhoodchain.blockscout.com/address/0x776993ff384098a01d45cbe8e46f5a07c2348dc3) | 35,590,891 | 0.000746839256744000 |
| fourbit-weights-0444 | [0xe8a49e6510340aa99f678244e2e1de39857e6091](https://robinhoodchain.blockscout.com/address/0xe8a49e6510340aa99f678244e2e1de39857e6091) | 35,599,425 | 0.000754921406550000 |
| fourbit-weights-0445 | [0xac957500ee22cfe875755ad04b2d12c28efddcff](https://robinhoodchain.blockscout.com/address/0xac957500ee22cfe875755ad04b2d12c28efddcff) | 35,558,462 | 0.000746798818924000 |
| fourbit-weights-0446 | [0xdafdcabd4d21ad3bfcabb54a5ec900dfde25f9d2](https://robinhoodchain.blockscout.com/address/0xdafdcabd4d21ad3bfcabb54a5ec900dfde25f9d2) | 35,645,402 | 0.000751618946572000 |
| fourbit-weights-0447 | [0x9a7461d113dcd73718f84b20a377b54885d538bf](https://robinhoodchain.blockscout.com/address/0x9a7461d113dcd73718f84b20a377b54885d538bf) | 35,564,677 | 0.000746360311522000 |
| fourbit-weights-0448 | [0x7ac077db73301be9815bb5beac655363acfa3918](https://robinhoodchain.blockscout.com/address/0x7ac077db73301be9815bb5beac655363acfa3918) | 35,382,018 | 0.000774936958236000 |
| fourbit-weights-0449 | [0xcb01ce910e57421ed95689279a851ee1765724f4](https://robinhoodchain.blockscout.com/address/0xcb01ce910e57421ed95689279a851ee1765724f4) | 35,486,540 | 0.000752030755680000 |
| fourbit-weights-0450 | [0x9462b8dc762045418276e6449f20f136077c1fce](https://robinhoodchain.blockscout.com/address/0x9462b8dc762045418276e6449f20f136077c1fce) | 35,282,446 | 0.000764076650576000 |
| fourbit-weights-0451 | [0x7dc2359552a0b2580a114929f8365f1d437e53a7](https://robinhoodchain.blockscout.com/address/0x7dc2359552a0b2580a114929f8365f1d437e53a7) | 35,384,083 | 0.000767551528436000 |
| fourbit-weights-0452 | [0x40be25f3719c34944c77f749cda1d3a62f811474](https://robinhoodchain.blockscout.com/address/0x40be25f3719c34944c77f749cda1d3a62f811474) | 35,453,925 | 0.000759139442100000 |
| fourbit-weights-0453 | [0x271ced3e63293edb1c31c21006a9f4fe3f6b3ffd](https://robinhoodchain.blockscout.com/address/0x271ced3e63293edb1c31c21006a9f4fe3f6b3ffd) | 35,458,815 | 0.000758038547070000 |
| fourbit-weights-0454 | [0x8995c9e32e12c340733b30d46b4f58eed6059b42](https://robinhoodchain.blockscout.com/address/0x8995c9e32e12c340733b30d46b4f58eed6059b42) | 35,545,028 | 0.000749289190240000 |
| fourbit-weights-0455 | [0xd6b5709482a273142530aedc4be7f2ccc7099547](https://robinhoodchain.blockscout.com/address/0xd6b5709482a273142530aedc4be7f2ccc7099547) | 35,339,875 | 0.000771116072500000 |
| fourbit-weights-0456 | [0xc5aaa9478b6fe8da73b12727293ae7ddc7ed33fa](https://robinhoodchain.blockscout.com/address/0xc5aaa9478b6fe8da73b12727293ae7ddc7ed33fa) | 35,208,891 | 0.000766427139288000 |
| fourbit-weights-0457 | [0xdb22cc989d4871743c55b12a45dbfe84b04bcd8b](https://robinhoodchain.blockscout.com/address/0xdb22cc989d4871743c55b12a45dbfe84b04bcd8b) | 35,178,097 | 0.000795798910334000 |
| fourbit-weights-0458 | [0xb64747c1b75e16052c8554d22f40a242b6a1ef87](https://robinhoodchain.blockscout.com/address/0xb64747c1b75e16052c8554d22f40a242b6a1ef87) | 35,584,998 | 0.000746929108020000 |
| fourbit-weights-0459 | [0x85d8809c777b009c767d59f4170b585efeb87a53](https://robinhoodchain.blockscout.com/address/0x85d8809c777b009c767d59f4170b585efeb87a53) | 35,733,382 | 0.000755046361660000 |
| fourbit-weights-0460 | [0x715ced5b974a79ef88abf88dedfb65e453665825](https://robinhoodchain.blockscout.com/address/0x715ced5b974a79ef88abf88dedfb65e453665825) | 35,546,053 | 0.000752581034116000 |
| fourbit-weights-0461 | [0x8eb16a64263b7fadfe19dd46612cb964d75682da](https://robinhoodchain.blockscout.com/address/0x8eb16a64263b7fadfe19dd46612cb964d75682da) | 35,551,300 | 0.000746292889600000 |
| fourbit-weights-0462 | [0x2e7a1976e288ee1b53d1ec38121e18dc135a5866](https://robinhoodchain.blockscout.com/address/0x2e7a1976e288ee1b53d1ec38121e18dc135a5866) | 35,547,905 | 0.000749634220640000 |
| fourbit-weights-0463 | [0x0979260324c793b7addbbdcf80d8e22bbdf9ae89](https://robinhoodchain.blockscout.com/address/0x0979260324c793b7addbbdcf80d8e22bbdf9ae89) | 35,624,817 | 0.000752894882478000 |
| fourbit-weights-0464 | [0xaf4717c208bc385149b7400437445024258bfe09](https://robinhoodchain.blockscout.com/address/0xaf4717c208bc385149b7400437445024258bfe09) | 35,565,600 | 0.000747517780800000 |
| fourbit-weights-0465 | [0xc24d9c19db0234cf6af839a4cbc2cdd83c2dfe9a](https://robinhoodchain.blockscout.com/address/0xc24d9c19db0234cf6af839a4cbc2cdd83c2dfe9a) | 35,561,612 | 0.000750563382872000 |
| fourbit-weights-0466 | [0x08b51d46c63c5820d6fb98c942d5b14169410a95](https://robinhoodchain.blockscout.com/address/0x08b51d46c63c5820d6fb98c942d5b14169410a95) | 35,526,496 | 0.000747406422848000 |
| fourbit-weights-0467 | [0x03fde24fad944479086bf9b599571e2cffce5d51](https://robinhoodchain.blockscout.com/address/0x03fde24fad944479086bf9b599571e2cffce5d51) | 35,466,278 | 0.000746636084456000 |
| fourbit-weights-0468 | [0xd1d1db75d10799409cf733ea48e6e3045655bbf2](https://robinhoodchain.blockscout.com/address/0xd1d1db75d10799409cf733ea48e6e3045655bbf2) | 35,535,204 | 0.000750148156440000 |
| fourbit-weights-0469 | [0x3e7a62545c6729c3dafa267545123b37e6ac2a12](https://robinhoodchain.blockscout.com/address/0x3e7a62545c6729c3dafa267545123b37e6ac2a12) | 35,573,240 | 0.000746824600560000 |
| fourbit-weights-0470 | [0xaeab16fde6c87c6405f77f49abab09b575e91816](https://robinhoodchain.blockscout.com/address/0xaeab16fde6c87c6405f77f49abab09b575e91816) | 35,539,546 | 0.000749742262416000 |
| fourbit-weights-0471 | [0x44d5c8a4b0c322f048505db7b00d1c35ddbf6f1a](https://robinhoodchain.blockscout.com/address/0x44d5c8a4b0c322f048505db7b00d1c35ddbf6f1a) | 35,526,741 | 0.000751461625632000 |
| fourbit-weights-0472 | [0xf26fa49d32ae2cc95494385ecf37763306acd3bf](https://robinhoodchain.blockscout.com/address/0xf26fa49d32ae2cc95494385ecf37763306acd3bf) | 35,602,831 | 0.000749012358578000 |
| fourbit-weights-0473 | [0xbd8c81956f1e91697c237ddab6386444995c1978](https://robinhoodchain.blockscout.com/address/0xbd8c81956f1e91697c237ddab6386444995c1978) | 35,439,632 | 0.000753304817792000 |
| fourbit-weights-0474 | [0x5dcb00aacc4560543680268eaa73a99b608629e6](https://robinhoodchain.blockscout.com/address/0x5dcb00aacc4560543680268eaa73a99b608629e6) | 35,615,510 | 0.000751487261000000 |
| fourbit-weights-0475 | [0xcec597f95012407d9f12303c312b89a162cbd138](https://robinhoodchain.blockscout.com/address/0xcec597f95012407d9f12303c312b89a162cbd138) | 35,565,754 | 0.000748232332652000 |
| fourbit-weights-0476 | [0x457711966219fbabf722428f0c0ac4c2368aa985](https://robinhoodchain.blockscout.com/address/0x457711966219fbabf722428f0c0ac4c2368aa985) | 35,390,565 | 0.000751341694950000 |
| fourbit-weights-0477 | [0xf1a66765071c466b8c4854b2e23ab0241704f016](https://robinhoodchain.blockscout.com/address/0xf1a66765071c466b8c4854b2e23ab0241704f016) | 35,649,441 | 0.000749137353174000 |
| fourbit-weights-0478 | [0x3765bd909dec97e38e942f0e6b4701f29e583ab0](https://robinhoodchain.blockscout.com/address/0x3765bd909dec97e38e942f0e6b4701f29e583ab0) | 35,574,215 | 0.000746987366570000 |
| fourbit-weights-0479 | [0x94b8cecc9df2cc144dabbb4ca273a4918ea00fdb](https://robinhoodchain.blockscout.com/address/0x94b8cecc9df2cc144dabbb4ca273a4918ea00fdb) | 35,588,978 | 0.000750785079888000 |
| fourbit-weights-0480 | [0x0e02320b8029388c26d019da482c02ae71abcd94](https://robinhoodchain.blockscout.com/address/0x0e02320b8029388c26d019da482c02ae71abcd94) | 35,593,135 | 0.000749591423100000 |
| fourbit-weights-0481 | [0x256df6a4069cfac404a9fd4471f22a2aec208b46](https://robinhoodchain.blockscout.com/address/0x256df6a4069cfac404a9fd4471f22a2aec208b46) | 35,476,675 | 0.000756717477750000 |
| fourbit-weights-0482 | [0x5091aaba35f6af59ccb647eaee2d5bf0f8a74371](https://robinhoodchain.blockscout.com/address/0x5091aaba35f6af59ccb647eaee2d5bf0f8a74371) | 35,588,905 | 0.000754627141620000 |
| fourbit-weights-0483 | [0x5275e66b9dda58448f67efda86ceaddf166206c4](https://robinhoodchain.blockscout.com/address/0x5275e66b9dda58448f67efda86ceaddf166206c4) | 35,596,618 | 0.000749878354788000 |
| fourbit-weights-0484 | [0xe52984926b0c3ff23c961b7c7fcc6dccdc581271](https://robinhoodchain.blockscout.com/address/0xe52984926b0c3ff23c961b7c7fcc6dccdc581271) | 35,471,164 | 0.000751208311192000 |
| fourbit-weights-0485 | [0xb1dd37127b4b4f49bf715071110d2b9699c8cbce](https://robinhoodchain.blockscout.com/address/0xb1dd37127b4b4f49bf715071110d2b9699c8cbce) | 35,574,719 | 0.000747211397876000 |
| fourbit-weights-0486 | [0xc4d28da4a5c2f48230845d04335d9a335255d064](https://robinhoodchain.blockscout.com/address/0xc4d28da4a5c2f48230845d04335d9a335255d064) | 35,519,365 | 0.000752442228160000 |
| fourbit-weights-0487 | [0x464919598634fd4716cf231848bb076e31328f90](https://robinhoodchain.blockscout.com/address/0x464919598634fd4716cf231848bb076e31328f90) | 35,501,509 | 0.000755543114538000 |
| fourbit-weights-0488 | [0x945f1956db16e62015c792a049e662ed48685e9a](https://robinhoodchain.blockscout.com/address/0x945f1956db16e62015c792a049e662ed48685e9a) | 35,602,827 | 0.000751290855354000 |
| fourbit-weights-0489 | [0xcb25f88796fb53248f387c6e9fbfde5a8eb635b6](https://robinhoodchain.blockscout.com/address/0xcb25f88796fb53248f387c6e9fbfde5a8eb635b6) | 35,566,004 | 0.000747099480024000 |
| fourbit-weights-0490 | [0x34b4c0266ff98b9114ea6b4141d97e055e2cbe2b](https://robinhoodchain.blockscout.com/address/0x34b4c0266ff98b9114ea6b4141d97e055e2cbe2b) | 35,462,841 | 0.000753798148296000 |
| fourbit-weights-0491 | [0x27b6bda2f4e4be2cac660590f5c23b48a9d5839e](https://robinhoodchain.blockscout.com/address/0x27b6bda2f4e4be2cac660590f5c23b48a9d5839e) | 35,653,335 | 0.000749005261680000 |
| fourbit-weights-0492 | [0x1defeb70d54b3074c54a4af23bb14ca0ce99a579](https://robinhoodchain.blockscout.com/address/0x1defeb70d54b3074c54a4af23bb14ca0ce99a579) | 35,513,259 | 0.000754301621160000 |
| fourbit-weights-0493 | [0x35a9ffbbff74a6580af6328d4e438c1610bc6796](https://robinhoodchain.blockscout.com/address/0x35a9ffbbff74a6580af6328d4e438c1610bc6796) | 35,628,828 | 0.000753478454544000 |
| fourbit-weights-0494 | [0x7d377b80657e52a3a9e7828fcc50d7948d4ea060](https://robinhoodchain.blockscout.com/address/0x7d377b80657e52a3a9e7828fcc50d7948d4ea060) | 17,784,102 | 0.000375315688608000 |
| FourBitWeightIndex | [0x4a5aaa46e02b8cbd3fa2c39802a3e8339c98ada0](https://robinhoodchain.blockscout.com/address/0x4a5aaa46e02b8cbd3fa2c39802a3e8339c98ada0) | 2,799,104 | 0.000059447370752000 |
