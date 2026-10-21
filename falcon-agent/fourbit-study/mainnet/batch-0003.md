# GH0ST four-bit RH deployment batch

Status: batch_complete_paused

This invocation verified 200 contracts; 6,128,158,275 gas; 0.129949535494012000 ETH.

Transactions are independent; HTTP bundling is not atomic and does not itself reduce chain gas.

| Measure | Value |
|---|---:|
| Four-bit contracts complete / planned | 375 / 497 |
| Old six-bit contracts retained | 2 |
| Wallet balance | 0.095456932662955787 ETH |
| Four-bit contracts remaining | 122 |
| Estimated remaining gas | 4,184,149,814 |
| Estimated remaining fee at snapshot price | 0.087791831397348000 ETH |
| Next batch quoted maximum | 0.132003304974936000 ETH |
| Reserve | 0.002000000000000000 ETH |
| Suggested top-up for next batch | 0.038546372311980213 ETH |

Snapshot (UTC): 2026-10-20T16:21:27.262954+00:00
Local Cancun execution gas calibrated by live total estimates/receipts including parent posting; RH prices may change. Index gas provisional.

No automatic next batch. RH receipts are not a claim of Ethereum finality.
Scope: immutable weights, matrix kernel and final index. Full inference is not implemented.

The third review batch is complete: **200 new contracts**, immutable weight shards 0174–0373. Submission used groups of at most four independent transactions. Deployment stopped at exactly 375 verified four-bit stage contracts. There are 377 contracts including the two historical pilots, with 122 remaining: 121 weight shards and the final index.

Actual execution used 5,988,915,717 gas. Parent posting used 139,242,558 gas and cost 0.002959165044142000 ETH. Unused signed gas-limit headroom was not charged. All 375 receipts and complete runtime bytes were checked again after completion. Latest/pending nonce: 377/377. There is no unresolved bundle.

Wallet opening balance was 0.225392274146592439 ETH; closing balance was 0.095456932662955787 ETH. Net external balance additions were 0.000014194010375348 ETH, calculated as closing balance minus opening balance plus actual receipt fees.

The next-batch maximum above covers the 121 remaining weight contracts only, at the snapshot price with 20% price headroom and parent-posting reserve. The final index cannot be quoted exactly until every shard address is verified. The remaining-stage gas/fee estimate includes provisional index gas. These are estimates for review; no further deployment starts automatically. The model and deployed runtime bytes are unchanged.

[Exact receipts and addresses](batch-0003.json) · [Deployment journal](deployment-state.json) · [Logical progress journal](batch-0003-logical-run.json) · [Final reconciliation](batch-0003-reconciliation.json)

## Verified contracts

| Contract | Address | Gas | Fee (ETH) |
|---|---|---:|---:|
| fourbit-weights-0174 | [0xa1bb1df2d96574dcd623e325fb1f311f29708932](https://robinhoodchain.blockscout.com/address/0xa1bb1df2d96574dcd623e325fb1f311f29708932) | 30,041,500 | 0.000630450919000000 |
| fourbit-weights-0175 | [0xf93d959e882c54ea0189494748914355f809cbca](https://robinhoodchain.blockscout.com/address/0xf93d959e882c54ea0189494748914355f809cbca) | 29,950,083 | 0.000624698831214000 |
| fourbit-weights-0176 | [0x2c374a56207974441538aa53574e17cc70eca8f2](https://robinhoodchain.blockscout.com/address/0x2c374a56207974441538aa53574e17cc70eca8f2) | 29,907,240 | 0.000670759578720000 |
| fourbit-weights-0177 | [0xcc381ef448b7a3a3539a70fb15f33833f46e076b](https://robinhoodchain.blockscout.com/address/0xcc381ef448b7a3a3539a70fb15f33833f46e076b) | 30,021,439 | 0.000630810476268000 |
| fourbit-weights-0178 | [0xcabd76680e970d66151e9d47967ef41d5f1c7d9a](https://robinhoodchain.blockscout.com/address/0xcabd76680e970d66151e9d47967ef41d5f1c7d9a) | 29,908,672 | 0.000625270696832000 |
| fourbit-weights-0179 | [0xb9fbfb9b4229405cc8edaa6ebcf959fd5a755e41](https://robinhoodchain.blockscout.com/address/0xb9fbfb9b4229405cc8edaa6ebcf959fd5a755e41) | 29,982,080 | 0.000627704826880000 |
| fourbit-weights-0180 | [0x68a4e7c043100e912eb7b8f224b3e95c3d5a92f0](https://robinhoodchain.blockscout.com/address/0x68a4e7c043100e912eb7b8f224b3e95c3d5a92f0) | 29,902,338 | 0.000673998698520000 |
| fourbit-weights-0181 | [0x899dc92c856ad8fd247a4c2711f485090ef34010](https://robinhoodchain.blockscout.com/address/0x899dc92c856ad8fd247a4c2711f485090ef34010) | 30,050,147 | 0.000700829528334000 |
| fourbit-weights-0182 | [0x09dd60c5b00a9b714f7c0ce9f0e18396ab18cf9a](https://robinhoodchain.blockscout.com/address/0x09dd60c5b00a9b714f7c0ce9f0e18396ab18cf9a) | 29,912,098 | 0.000629051420940000 |
| fourbit-weights-0183 | [0x3e38c2d1a01f94aab2e9eab959e8a1a6d6498782](https://robinhoodchain.blockscout.com/address/0x3e38c2d1a01f94aab2e9eab959e8a1a6d6498782) | 29,913,369 | 0.000635539437774000 |
| fourbit-weights-0184 | [0x1687633fdbf8ea5cfcbe43c648bae419b21781d0](https://robinhoodchain.blockscout.com/address/0x1687633fdbf8ea5cfcbe43c648bae419b21781d0) | 29,909,887 | 0.000639293924738000 |
| fourbit-weights-0185 | [0xf1a35411a51cc208f421e12c35acee3933b53b2e](https://robinhoodchain.blockscout.com/address/0xf1a35411a51cc208f421e12c35acee3933b53b2e) | 29,913,941 | 0.000626517580304000 |
| fourbit-weights-0186 | [0x01ad1cdf471fa873f2879aaf99893f3c49821d94](https://robinhoodchain.blockscout.com/address/0x01ad1cdf471fa873f2879aaf99893f3c49821d94) | 29,995,648 | 0.000627688930048000 |
| fourbit-weights-0187 | [0x6ada892d8d7683379bebc8cdb55a9918d4b9497f](https://robinhoodchain.blockscout.com/address/0x6ada892d8d7683379bebc8cdb55a9918d4b9497f) | 29,886,062 | 0.000628025706868000 |
| fourbit-weights-0188 | [0xd7ff8b8a7049c1af1943182dcb7b6f400581d4e2](https://robinhoodchain.blockscout.com/address/0xd7ff8b8a7049c1af1943182dcb7b6f400581d4e2) | 30,021,446 | 0.000629669808404000 |
| fourbit-weights-0189 | [0x32c2ef5275c79e25a236eed154d6167e7f19e367](https://robinhoodchain.blockscout.com/address/0x32c2ef5275c79e25a236eed154d6167e7f19e367) | 29,938,404 | 0.000642358396224000 |
| fourbit-weights-0190 | [0x1ff61279e8a415718e3ccf8d4aeaf0b976c6d6b6](https://robinhoodchain.blockscout.com/address/0x1ff61279e8a415718e3ccf8d4aeaf0b976c6d6b6) | 30,023,346 | 0.000626587231020000 |
| fourbit-weights-0191 | [0xbce33c2bae2037fe324c2e76d69362e805eb1dfc](https://robinhoodchain.blockscout.com/address/0xbce33c2bae2037fe324c2e76d69362e805eb1dfc) | 30,086,744 | 0.000638139840240000 |
| fourbit-weights-0192 | [0x04e11a0135410f62fa9a0c9150e94dc9fb0ee623](https://robinhoodchain.blockscout.com/address/0x04e11a0135410f62fa9a0c9150e94dc9fb0ee623) | 29,916,533 | 0.000634709164128000 |
| fourbit-weights-0193 | [0x91f72dadf949883164d47f60840d1bacde2f6843](https://robinhoodchain.blockscout.com/address/0x91f72dadf949883164d47f60840d1bacde2f6843) | 29,961,126 | 0.000627925278708000 |
| fourbit-weights-0194 | [0xba8a70f7baa6d7f00cbe1105d83202d4eb34b5e1](https://robinhoodchain.blockscout.com/address/0xba8a70f7baa6d7f00cbe1105d83202d4eb34b5e1) | 29,914,902 | 0.000627913792980000 |
| fourbit-weights-0195 | [0x637fb8acb942cb45b492f4b29dae61fe89d5570c](https://robinhoodchain.blockscout.com/address/0x637fb8acb942cb45b492f4b29dae61fe89d5570c) | 29,915,172 | 0.000624748452048000 |
| fourbit-weights-0196 | [0x253f188cf459eeae05c2c0d90fec3c80f02cc735](https://robinhoodchain.blockscout.com/address/0x253f188cf459eeae05c2c0d90fec3c80f02cc735) | 29,862,445 | 0.000624602899620000 |
| fourbit-weights-0197 | [0x341cd424d33bafb06dc4ab065ad588286dc264ca](https://robinhoodchain.blockscout.com/address/0x341cd424d33bafb06dc4ab065ad588286dc264ca) | 29,901,713 | 0.000630029092910000 |
| fourbit-weights-0198 | [0xea9758501bb7cf7c002fec6ab5e399ee18baca08](https://robinhoodchain.blockscout.com/address/0xea9758501bb7cf7c002fec6ab5e399ee18baca08) | 30,081,771 | 0.000634424550390000 |
| fourbit-weights-0199 | [0x02059ba5fc73a2cc5b6cab5b61e3e90d82adb51a](https://robinhoodchain.blockscout.com/address/0x02059ba5fc73a2cc5b6cab5b61e3e90d82adb51a) | 29,905,406 | 0.000624365066468000 |
| fourbit-weights-0200 | [0x13d99d10a1597f8ab7787e282320287fef970722](https://robinhoodchain.blockscout.com/address/0x13d99d10a1597f8ab7787e282320287fef970722) | 29,907,368 | 0.000649767477168000 |
| fourbit-weights-0201 | [0xdec5489518cf8069028117efdc54d77dc5a67d44](https://robinhoodchain.blockscout.com/address/0xdec5489518cf8069028117efdc54d77dc5a67d44) | 29,911,558 | 0.000629817765248000 |
| fourbit-weights-0202 | [0xf1fc4e26e1c71fb729b4005d8cc4c0c3f8156591](https://robinhoodchain.blockscout.com/address/0xf1fc4e26e1c71fb729b4005d8cc4c0c3f8156591) | 29,952,687 | 0.000631642263456000 |
| fourbit-weights-0203 | [0xcdd9c2030a00ffce935046a07fb97465955cff12](https://robinhoodchain.blockscout.com/address/0xcdd9c2030a00ffce935046a07fb97465955cff12) | 29,911,291 | 0.000628436223910000 |
| fourbit-weights-0204 | [0x6b841b20c73a0769a4770b43666088de631f36da](https://robinhoodchain.blockscout.com/address/0x6b841b20c73a0769a4770b43666088de631f36da) | 29,864,680 | 0.000625605316640000 |
| fourbit-weights-0205 | [0x2aa8fcd31d62adc689386ca1aa9c5d59d478da4d](https://robinhoodchain.blockscout.com/address/0x2aa8fcd31d62adc689386ca1aa9c5d59d478da4d) | 29,775,885 | 0.000628509380580000 |
| fourbit-weights-0206 | [0x14ba670dabb3e21a5012787cc46fbd2785a173dc](https://robinhoodchain.blockscout.com/address/0x14ba670dabb3e21a5012787cc46fbd2785a173dc) | 29,895,598 | 0.000628465261156000 |
| fourbit-weights-0207 | [0xb2128cfc755ae8d70156cfe1caaf6c99288da0fe](https://robinhoodchain.blockscout.com/address/0xb2128cfc755ae8d70156cfe1caaf6c99288da0fe) | 30,037,238 | 0.000629520434004000 |
| fourbit-weights-0208 | [0xe16d8cfbe09e8bc8367abc8fe7f9034d38c63c0d](https://robinhoodchain.blockscout.com/address/0xe16d8cfbe09e8bc8367abc8fe7f9034d38c63c0d) | 30,080,584 | 0.000630368718304000 |
| fourbit-weights-0209 | [0x255a9ba03c7885f6ddce50defbe2e9ce2aa92613](https://robinhoodchain.blockscout.com/address/0x255a9ba03c7885f6ddce50defbe2e9ce2aa92613) | 29,919,377 | 0.000628426594508000 |
| fourbit-weights-0210 | [0xcf30253062c7ba405e8e117981c3ea4bc95ee157](https://robinhoodchain.blockscout.com/address/0xcf30253062c7ba405e8e117981c3ea4bc95ee157) | 30,024,742 | 0.000635623788140000 |
| fourbit-weights-0211 | [0x1ec7d3376ee7c14fe7571ea90bc9c6a1d0ccff1d](https://robinhoodchain.blockscout.com/address/0x1ec7d3376ee7c14fe7571ea90bc9c6a1d0ccff1d) | 29,914,207 | 0.000624668470574000 |
| fourbit-weights-0212 | [0xf1158752f83716d8693eae8ddabc4b032ab36434](https://robinhoodchain.blockscout.com/address/0xf1158752f83716d8693eae8ddabc4b032ab36434) | 29,604,612 | 0.000626196753024000 |
| fourbit-weights-0213 | [0x1275cfb80a9fc161744e79de85173aee1ef22e94](https://robinhoodchain.blockscout.com/address/0x1275cfb80a9fc161744e79de85173aee1ef22e94) | 29,908,040 | 0.000627650127440000 |
| fourbit-weights-0214 | [0x1954683689fe885807ac26830522671c3b9a0d12](https://robinhoodchain.blockscout.com/address/0x1954683689fe885807ac26830522671c3b9a0d12) | 29,950,370 | 0.000630694891460000 |
| fourbit-weights-0215 | [0x193a082e7bfc27d0c35cf97dcb3ab3ca0d80f1c3](https://robinhoodchain.blockscout.com/address/0x193a082e7bfc27d0c35cf97dcb3ab3ca0d80f1c3) | 30,028,129 | 0.000634194084480000 |
| fourbit-weights-0216 | [0xdf72cda3e67ac215b76052ce1b80d0146d23313a](https://robinhoodchain.blockscout.com/address/0xdf72cda3e67ac215b76052ce1b80d0146d23313a) | 29,915,729 | 0.000653299689902000 |
| fourbit-weights-0217 | [0x1bcd8e2611e22e92b614bb868e5c7d27fbf9a69e](https://robinhoodchain.blockscout.com/address/0x1bcd8e2611e22e92b614bb868e5c7d27fbf9a69e) | 29,920,254 | 0.000624914425044000 |
| fourbit-weights-0218 | [0x50b47d39b229db50b720272385abf49f2ed02557](https://robinhoodchain.blockscout.com/address/0x50b47d39b229db50b720272385abf49f2ed02557) | 29,913,144 | 0.000644568426912000 |
| fourbit-weights-0219 | [0x3b8fee7da1b43ccbd75b7f4d14a41342fd4785f0](https://robinhoodchain.blockscout.com/address/0x3b8fee7da1b43ccbd75b7f4d14a41342fd4785f0) | 30,020,056 | 0.000627058929728000 |
| fourbit-weights-0220 | [0x8a1afbe6746498bf9506c8011d8444a69d59c41d](https://robinhoodchain.blockscout.com/address/0x8a1afbe6746498bf9506c8011d8444a69d59c41d) | 29,839,677 | 0.000637136783304000 |
| fourbit-weights-0221 | [0xd582d2c51d7050a3397f04cb3169e5310da2cb9e](https://robinhoodchain.blockscout.com/address/0xd582d2c51d7050a3397f04cb3169e5310da2cb9e) | 29,970,731 | 0.000628366346146000 |
| fourbit-weights-0222 | [0x3840f2915a039d2d6de7f29f99e6c2ba46f29404](https://robinhoodchain.blockscout.com/address/0x3840f2915a039d2d6de7f29f99e6c2ba46f29404) | 29,917,958 | 0.000625404994032000 |
| fourbit-weights-0223 | [0x14b1b5f545a2cb3f4dc7540bdc775a8993e1d14e](https://robinhoodchain.blockscout.com/address/0x14b1b5f545a2cb3f4dc7540bdc775a8993e1d14e) | 29,912,499 | 0.000650656678248000 |
| fourbit-weights-0224 | [0xde916b61a7acd240b6adc9d9f550b2c74bbd3252](https://robinhoodchain.blockscout.com/address/0xde916b61a7acd240b6adc9d9f550b2c74bbd3252) | 29,972,197 | 0.000626418917300000 |
| fourbit-weights-0225 | [0xabaad8773e48b52fdeecc75c383b2bf7af51218a](https://robinhoodchain.blockscout.com/address/0xabaad8773e48b52fdeecc75c383b2bf7af51218a) | 30,062,320 | 0.000628963859040000 |
| fourbit-weights-0226 | [0xd018912d6924b01199e5bfc2565eb98f6879cd43](https://robinhoodchain.blockscout.com/address/0xd018912d6924b01199e5bfc2565eb98f6879cd43) | 29,915,133 | 0.000629952870714000 |
| fourbit-weights-0227 | [0x3baeb911c9ff475dda19f67b197d132f5e763c1b](https://robinhoodchain.blockscout.com/address/0x3baeb911c9ff475dda19f67b197d132f5e763c1b) | 30,022,630 | 0.000628193510120000 |
| fourbit-weights-0228 | [0xa74d50ce87187751e772fc17281d84b5aa265431](https://robinhoodchain.blockscout.com/address/0xa74d50ce87187751e772fc17281d84b5aa265431) | 29,913,203 | 0.000624946637076000 |
| fourbit-weights-0229 | [0x358d23d98b1d49977c965f6cd756ecc6e66df768](https://robinhoodchain.blockscout.com/address/0x358d23d98b1d49977c965f6cd756ecc6e66df768) | 30,003,628 | 0.000628455992088000 |
| fourbit-weights-0230 | [0x120d88bc071d0adb731ca343d6a470da0bd58324](https://robinhoodchain.blockscout.com/address/0x120d88bc071d0adb731ca343d6a470da0bd58324) | 29,907,393 | 0.000626260809420000 |
| fourbit-weights-0231 | [0xa49a014e83460da6f964f7ec7914a879bace1eba](https://robinhoodchain.blockscout.com/address/0xa49a014e83460da6f964f7ec7914a879bace1eba) | 30,041,181 | 0.000629002247778000 |
| fourbit-weights-0232 | [0xbdf7d8888990ddfa0e23fb9448920c40a4c93341](https://robinhoodchain.blockscout.com/address/0xbdf7d8888990ddfa0e23fb9448920c40a4c93341) | 29,931,192 | 0.000628076132928000 |
| fourbit-weights-0233 | [0xe68de528d4a090207b9248c0bbb5dff20b0e0918](https://robinhoodchain.blockscout.com/address/0xe68de528d4a090207b9248c0bbb5dff20b0e0918) | 29,917,149 | 0.000627482283126000 |
| fourbit-weights-0234 | [0x54c8053d8e2a06f98bae2bbdc2cfea3e4c4c1e81](https://robinhoodchain.blockscout.com/address/0x54c8053d8e2a06f98bae2bbdc2cfea3e4c4c1e81) | 29,916,286 | 0.000627823177996000 |
| fourbit-weights-0235 | [0xcd0aedfb1eb46e8b29b465fa780915dc9e14b308](https://robinhoodchain.blockscout.com/address/0xcd0aedfb1eb46e8b29b465fa780915dc9e14b308) | 29,915,388 | 0.000626727378600000 |
| fourbit-weights-0236 | [0x1d1512c500f7ff7ac766162d860ebdf831562f7f](https://robinhoodchain.blockscout.com/address/0x1d1512c500f7ff7ac766162d860ebdf831562f7f) | 30,019,703 | 0.000628192304978000 |
| fourbit-weights-0237 | [0x515bc63062f69a404c0fc2b1d8e48ab7277e5a66](https://robinhoodchain.blockscout.com/address/0x515bc63062f69a404c0fc2b1d8e48ab7277e5a66) | 29,866,939 | 0.000635150324774000 |
| fourbit-weights-0238 | [0xbc91d19c084f4e70ebd117051aaf0c4a99887549](https://robinhoodchain.blockscout.com/address/0xbc91d19c084f4e70ebd117051aaf0c4a99887549) | 29,987,983 | 0.000636584903124000 |
| fourbit-weights-0239 | [0x860e8941cb6d87273d56f1331a6d9c1567d50e76](https://robinhoodchain.blockscout.com/address/0x860e8941cb6d87273d56f1331a6d9c1567d50e76) | 29,916,102 | 0.000629434786080000 |
| fourbit-weights-0240 | [0x12d996d6b255a799035f931c9e2f43899980941d](https://robinhoodchain.blockscout.com/address/0x12d996d6b255a799035f931c9e2f43899980941d) | 30,221,500 | 0.000633321754000000 |
| fourbit-weights-0241 | [0xb6dc62ac11c24fbe59e3945777bab8b67e68183d](https://robinhoodchain.blockscout.com/address/0xb6dc62ac11c24fbe59e3945777bab8b67e68183d) | 29,919,367 | 0.000637282517100000 |
| fourbit-weights-0242 | [0x4c4fd1aa27feee925cebf308bc17d7eeaf79352b](https://robinhoodchain.blockscout.com/address/0x4c4fd1aa27feee925cebf308bc17d7eeaf79352b) | 30,033,969 | 0.000632815726830000 |
| fourbit-weights-0243 | [0x4bfe0295e827f01ee74f82be23d6082cec453d64](https://robinhoodchain.blockscout.com/address/0x4bfe0295e827f01ee74f82be23d6082cec453d64) | 29,912,365 | 0.000652687804300000 |
| fourbit-weights-0244 | [0x7c1e08d5abb66a7c0410bf635c8be5c831d0edef](https://robinhoodchain.blockscout.com/address/0x7c1e08d5abb66a7c0410bf635c8be5c831d0edef) | 30,013,654 | 0.000627285368600000 |
| fourbit-weights-0245 | [0x13a0b1664fde621407b1ea7407b53e58c482334e](https://robinhoodchain.blockscout.com/address/0x13a0b1664fde621407b1ea7407b53e58c482334e) | 29,908,304 | 0.000625083553600000 |
| fourbit-weights-0246 | [0xabf49b15dfd18cf5c0aceddfcd00c3123095654b](https://robinhoodchain.blockscout.com/address/0xabf49b15dfd18cf5c0aceddfcd00c3123095654b) | 30,012,287 | 0.000627256798300000 |
| fourbit-weights-0247 | [0x725cf5afa544c6a733fc7173bb7fe1c0598f679d](https://robinhoodchain.blockscout.com/address/0x725cf5afa544c6a733fc7173bb7fe1c0598f679d) | 29,914,574 | 0.000628265883148000 |
| fourbit-weights-0248 | [0x95c638c111f7d8f7db7e461a47e22c072583dd99](https://robinhoodchain.blockscout.com/address/0x95c638c111f7d8f7db7e461a47e22c072583dd99) | 29,854,303 | 0.000626283568334000 |
| fourbit-weights-0249 | [0x9fe54d4c223ca14f1f2489ae46817ea9809c07d8](https://robinhoodchain.blockscout.com/address/0x9fe54d4c223ca14f1f2489ae46817ea9809c07d8) | 29,911,415 | 0.000629395994430000 |
| fourbit-weights-0250 | [0x566b7cc8baef24474fca23a9713d0946e0b32138](https://robinhoodchain.blockscout.com/address/0x566b7cc8baef24474fca23a9713d0946e0b32138) | 29,912,784 | 0.000630322184448000 |
| fourbit-weights-0251 | [0xc3a3bdd28f6249166a328b752e50d455cd4e3c67](https://robinhoodchain.blockscout.com/address/0xc3a3bdd28f6249166a328b752e50d455cd4e3c67) | 29,907,567 | 0.000625965377310000 |
| fourbit-weights-0252 | [0xfcf831a4ea7022fb535e86c57617d84c70823e02](https://robinhoodchain.blockscout.com/address/0xfcf831a4ea7022fb535e86c57617d84c70823e02) | 29,910,968 | 0.000636026823552000 |
| fourbit-weights-0253 | [0xdcc4527504444b73f5c5f2e24178fe32b3c11860](https://robinhoodchain.blockscout.com/address/0xdcc4527504444b73f5c5f2e24178fe32b3c11860) | 30,011,058 | 0.000631012505508000 |
| fourbit-weights-0254 | [0xc74734f86d67fa9246228352da5ab3f814895960](https://robinhoodchain.blockscout.com/address/0xc74734f86d67fa9246228352da5ab3f814895960) | 29,868,997 | 0.000626830771042000 |
| fourbit-weights-0255 | [0x2b52cd01d279c615b875acbfcb1316b45d3b46b4](https://robinhoodchain.blockscout.com/address/0x2b52cd01d279c615b875acbfcb1316b45d3b46b4) | 30,007,596 | 0.000654405653568000 |
| fourbit-weights-0256 | [0xbced0737c51c63b9cff0bef08a822ef403011cf4](https://robinhoodchain.blockscout.com/address/0xbced0737c51c63b9cff0bef08a822ef403011cf4) | 29,910,503 | 0.000634042842594000 |
| fourbit-weights-0257 | [0x8baa38a3e5f96298ee5aae9f94c47853ee9733a7](https://robinhoodchain.blockscout.com/address/0x8baa38a3e5f96298ee5aae9f94c47853ee9733a7) | 29,890,875 | 0.000628545319500000 |
| fourbit-weights-0258 | [0xe97d7f8a0acd9fb29be7e17202f2d519ff2aadba](https://robinhoodchain.blockscout.com/address/0xe97d7f8a0acd9fb29be7e17202f2d519ff2aadba) | 29,922,499 | 0.000626577129060000 |
| fourbit-weights-0259 | [0x1b28d061c53085c0791d834a5831570982bb87b6](https://robinhoodchain.blockscout.com/address/0x1b28d061c53085c0791d834a5831570982bb87b6) | 29,611,598 | 0.000641505659072000 |
| fourbit-weights-0260 | [0x505314416951c78a69e7d76f9a9dc5f851f23a86](https://robinhoodchain.blockscout.com/address/0x505314416951c78a69e7d76f9a9dc5f851f23a86) | 29,910,883 | 0.000630042839512000 |
| fourbit-weights-0261 | [0x76eaed9efec95402b5571a6302b718356b074842](https://robinhoodchain.blockscout.com/address/0x76eaed9efec95402b5571a6302b718356b074842) | 30,022,037 | 0.000637367845510000 |
| fourbit-weights-0262 | [0xb1ac602203793b6189f0cd1ff46056bd838f6009](https://robinhoodchain.blockscout.com/address/0xb1ac602203793b6189f0cd1ff46056bd838f6009) | 29,902,166 | 0.000657668239004000 |
| fourbit-weights-0263 | [0x66a759fe30cbaa9438db664cbffb94b0887fa0f9](https://robinhoodchain.blockscout.com/address/0x66a759fe30cbaa9438db664cbffb94b0887fa0f9) | 30,009,418 | 0.000645502581180000 |
| fourbit-weights-0264 | [0xe11f3f802392ded25c480d5e008f742952335755](https://robinhoodchain.blockscout.com/address/0xe11f3f802392ded25c480d5e008f742952335755) | 29,919,367 | 0.000631238804966000 |
| fourbit-weights-0265 | [0xdb786f27dff4f5c9834a043faba42608a0accb89](https://robinhoodchain.blockscout.com/address/0xdb786f27dff4f5c9834a043faba42608a0accb89) | 30,090,445 | 0.000635209293950000 |
| fourbit-weights-0266 | [0x5587e0f88c5a1201208a92039cfdceffd28894fe](https://robinhoodchain.blockscout.com/address/0x5587e0f88c5a1201208a92039cfdceffd28894fe) | 29,914,921 | 0.000627375723212000 |
| fourbit-weights-0267 | [0x742deb029cf6186d4df1ea1ae92eb0596a6f740a](https://robinhoodchain.blockscout.com/address/0x742deb029cf6186d4df1ea1ae92eb0596a6f740a) | 29,918,297 | 0.000625651426864000 |
| fourbit-weights-0268 | [0x796d22538e8b05994cdace356501664d30c8e97f](https://robinhoodchain.blockscout.com/address/0x796d22538e8b05994cdace356501664d30c8e97f) | 29,912,593 | 0.000645693232498000 |
| fourbit-weights-0269 | [0xee276e896f7ffa1b32c9db84e4753e3eabb17892](https://robinhoodchain.blockscout.com/address/0xee276e896f7ffa1b32c9db84e4753e3eabb17892) | 29,912,450 | 0.000647664367400000 |
| fourbit-weights-0270 | [0xbb7f63db61cb0d7d32f2bb6b605728d1b3d29de8](https://robinhoodchain.blockscout.com/address/0xbb7f63db61cb0d7d32f2bb6b605728d1b3d29de8) | 30,000,083 | 0.000629821742502000 |
| fourbit-weights-0271 | [0x67b3b9f2c536e9be0543f1a98dfb9561eb205c3a](https://robinhoodchain.blockscout.com/address/0x67b3b9f2c536e9be0543f1a98dfb9561eb205c3a) | 29,878,502 | 0.000654578221816000 |
| fourbit-weights-0272 | [0x35a195cedc1d8a91b0f74b695ca1221f140753e0](https://robinhoodchain.blockscout.com/address/0x35a195cedc1d8a91b0f74b695ca1221f140753e0) | 30,015,095 | 0.000654028920050000 |
| fourbit-weights-0273 | [0x236af4190314a3c2c6142d8f0726836c898eb500](https://robinhoodchain.blockscout.com/address/0x236af4190314a3c2c6142d8f0726836c898eb500) | 30,016,653 | 0.000633411411606000 |
| fourbit-weights-0274 | [0x6c41f9e874a527674166f53b08c16f439ed94abe](https://robinhoodchain.blockscout.com/address/0x6c41f9e874a527674166f53b08c16f439ed94abe) | 29,877,538 | 0.000628145358912000 |
| fourbit-weights-0275 | [0x4f297f6b4befb4db6443ebe7c5d082d0d6c937b2](https://robinhoodchain.blockscout.com/address/0x4f297f6b4befb4db6443ebe7c5d082d0d6c937b2) | 30,017,800 | 0.000631274334000000 |
| fourbit-weights-0276 | [0x0f1dd245040a3355285f944777009e358e54121b](https://robinhoodchain.blockscout.com/address/0x0f1dd245040a3355285f944777009e358e54121b) | 29,947,518 | 0.000631113994332000 |
| fourbit-weights-0277 | [0xeba5a2ebf830784ea8bfc3b924b4dd6498323779](https://robinhoodchain.blockscout.com/address/0xeba5a2ebf830784ea8bfc3b924b4dd6498323779) | 29,916,048 | 0.000635416859520000 |
| fourbit-weights-0278 | [0x526b2f7d0bb24e5af9f609e5bb4c222755ff400b](https://robinhoodchain.blockscout.com/address/0x526b2f7d0bb24e5af9f609e5bb4c222755ff400b) | 29,789,714 | 0.000642742869264000 |
| fourbit-weights-0279 | [0xa07b65f02652caa47b6fd6cf11eee7e82037232a](https://robinhoodchain.blockscout.com/address/0xa07b65f02652caa47b6fd6cf11eee7e82037232a) | 29,911,298 | 0.000650929667076000 |
| fourbit-weights-0280 | [0x5e3c3d954c869e2590b83eeec485fd7dee94fc93](https://robinhoodchain.blockscout.com/address/0x5e3c3d954c869e2590b83eeec485fd7dee94fc93) | 30,016,556 | 0.000637131417656000 |
| fourbit-weights-0281 | [0x0783592b1dde7cc3e5362732e43b4d86ae0b504a](https://robinhoodchain.blockscout.com/address/0x0783592b1dde7cc3e5362732e43b4d86ae0b504a) | 29,917,510 | 0.000627011174580000 |
| fourbit-weights-0282 | [0x36e7d05f5894a8b210d85a11361f929fc2546118](https://robinhoodchain.blockscout.com/address/0x36e7d05f5894a8b210d85a11361f929fc2546118) | 30,083,136 | 0.000634994834688000 |
| fourbit-weights-0283 | [0xea3b097b49aaf5d7730c0386763ea724e1c0ccd0](https://robinhoodchain.blockscout.com/address/0xea3b097b49aaf5d7730c0386763ea724e1c0ccd0) | 29,915,467 | 0.000631934324908000 |
| fourbit-weights-0284 | [0xa8d0c2d3ca2c39465cd2d178a8cdf02feff42861](https://robinhoodchain.blockscout.com/address/0xa8d0c2d3ca2c39465cd2d178a8cdf02feff42861) | 29,913,050 | 0.000677949365200000 |
| fourbit-weights-0285 | [0xfcb97302a44a7b39b08896f9239ff07c6389eeeb](https://robinhoodchain.blockscout.com/address/0xfcb97302a44a7b39b08896f9239ff07c6389eeeb) | 29,911,200 | 0.000629810227200000 |
| fourbit-weights-0286 | [0xd6c700f661561ed4c6d648a0724777ec93e9d46d](https://robinhoodchain.blockscout.com/address/0xd6c700f661561ed4c6d648a0724777ec93e9d46d) | 29,915,627 | 0.000630382092144000 |
| fourbit-weights-0287 | [0xa67b7b9ae2ebc01dd0d1b2b92cf21920acabaf84](https://robinhoodchain.blockscout.com/address/0xa67b7b9ae2ebc01dd0d1b2b92cf21920acabaf84) | 29,652,365 | 0.000625427682580000 |
| fourbit-weights-0288 | [0x169f6fe5be39c66df9400a37fd1e2ca0ae4e69b3](https://robinhoodchain.blockscout.com/address/0x169f6fe5be39c66df9400a37fd1e2ca0ae4e69b3) | 29,882,507 | 0.000673910297864000 |
| fourbit-weights-0289 | [0x9ebc125c1e3d365f5ecf2d9388ee24a316b5eec5](https://robinhoodchain.blockscout.com/address/0x9ebc125c1e3d365f5ecf2d9388ee24a316b5eec5) | 30,031,786 | 0.000642860411116000 |
| fourbit-weights-0290 | [0x1e61700ca6b754af9541996d81d22fbb13300aa0](https://robinhoodchain.blockscout.com/address/0x1e61700ca6b754af9541996d81d22fbb13300aa0) | 29,926,665 | 0.000629178204960000 |
| fourbit-weights-0291 | [0x865d1a8d68b69e2adb4e919355952196688dedcd](https://robinhoodchain.blockscout.com/address/0x865d1a8d68b69e2adb4e919355952196688dedcd) | 30,027,778 | 0.000628961837988000 |
| fourbit-weights-0292 | [0x65edc6052ecf94217821403e3b04d3b5101fc366](https://robinhoodchain.blockscout.com/address/0x65edc6052ecf94217821403e3b04d3b5101fc366) | 30,066,705 | 0.000629115735420000 |
| fourbit-weights-0293 | [0x0b2982b43642a66eefc9ee617ea18d9f86599159](https://robinhoodchain.blockscout.com/address/0x0b2982b43642a66eefc9ee617ea18d9f86599159) | 29,917,824 | 0.000629830030848000 |
| fourbit-weights-0294 | [0xe646b1b3f3f36d37b20d6734d346175b394d9167](https://robinhoodchain.blockscout.com/address/0xe646b1b3f3f36d37b20d6734d346175b394d9167) | 29,727,860 | 0.000626484921640000 |
| fourbit-weights-0295 | [0x545757f1b6f813d0c30eb664adf7639ff8e6d8a2](https://robinhoodchain.blockscout.com/address/0x545757f1b6f813d0c30eb664adf7639ff8e6d8a2) | 29,917,050 | 0.000629634234300000 |
| fourbit-weights-0296 | [0x88bb6a73a99e5e8d50060bdab0b392fc0a91df7a](https://robinhoodchain.blockscout.com/address/0x88bb6a73a99e5e8d50060bdab0b392fc0a91df7a) | 29,946,855 | 0.000628165230480000 |
| fourbit-weights-0297 | [0xa011e1c39a85543d9a10d5a43f59678ff9b8b6a8](https://robinhoodchain.blockscout.com/address/0xa011e1c39a85543d9a10d5a43f59678ff9b8b6a8) | 29,944,946 | 0.000628843866000000 |
| fourbit-weights-0298 | [0x914258236c14b3497e2494c29d547bdd5c99c876](https://robinhoodchain.blockscout.com/address/0x914258236c14b3497e2494c29d547bdd5c99c876) | 29,918,852 | 0.000631886154240000 |
| fourbit-weights-0299 | [0x16ab3aedc2d7dc868ba6640304af0e66f9e7b45b](https://robinhoodchain.blockscout.com/address/0x16ab3aedc2d7dc868ba6640304af0e66f9e7b45b) | 30,093,362 | 0.000637437593884000 |
| fourbit-weights-0300 | [0xa004a03040fafdd6bebed8c2b20429499ff9e766](https://robinhoodchain.blockscout.com/address/0xa004a03040fafdd6bebed8c2b20429499ff9e766) | 29,913,507 | 0.000628961398182000 |
| fourbit-weights-0301 | [0x693e817ccc02cd1e8c2301de9cc9e16b1dbf3cdb](https://robinhoodchain.blockscout.com/address/0x693e817ccc02cd1e8c2301de9cc9e16b1dbf3cdb) | 29,917,555 | 0.000626533436810000 |
| fourbit-weights-0302 | [0xef9c741a39eef39cbd1f5cfeec0a60227b314442](https://robinhoodchain.blockscout.com/address/0xef9c741a39eef39cbd1f5cfeec0a60227b314442) | 29,914,786 | 0.000627432721564000 |
| fourbit-weights-0303 | [0x0ab98e226115916aa8a553735cc52b1d7c1f7a8b](https://robinhoodchain.blockscout.com/address/0x0ab98e226115916aa8a553735cc52b1d7c1f7a8b) | 29,840,639 | 0.000625101705772000 |
| fourbit-weights-0304 | [0x23d12dcd1704539e299b788445ae8d8eefacdb90](https://robinhoodchain.blockscout.com/address/0x23d12dcd1704539e299b788445ae8d8eefacdb90) | 29,882,497 | 0.000625380897216000 |
| fourbit-weights-0305 | [0x9110da35c32c3924df60e7acb15b28de44a1862d](https://robinhoodchain.blockscout.com/address/0x9110da35c32c3924df60e7acb15b28de44a1862d) | 29,918,802 | 0.000637270482600000 |
| fourbit-weights-0306 | [0x7ffc87cb594da7276ce0b67d9c8efd095bde2edc](https://robinhoodchain.blockscout.com/address/0x7ffc87cb594da7276ce0b67d9c8efd095bde2edc) | 29,962,197 | 0.000634419559278000 |
| fourbit-weights-0307 | [0x6933fa4c4ca7bc1c35caf7d7eb2f37e820444076](https://robinhoodchain.blockscout.com/address/0x6933fa4c4ca7bc1c35caf7d7eb2f37e820444076) | 29,920,536 | 0.000630186329232000 |
| fourbit-weights-0308 | [0x57fd22fb8a92dc1e2077cb4dec88c22ff4c989c3](https://robinhoodchain.blockscout.com/address/0x57fd22fb8a92dc1e2077cb4dec88c22ff4c989c3) | 30,021,548 | 0.000638378196672000 |
| fourbit-weights-0309 | [0x6954e4d9cbb680dda1bb2fcd104b838798fbc7fd](https://robinhoodchain.blockscout.com/address/0x6954e4d9cbb680dda1bb2fcd104b838798fbc7fd) | 30,073,281 | 0.000631298314752000 |
| fourbit-weights-0310 | [0xf3bee36ee9c798a3fbf55837b13c4e09d6a02c73](https://robinhoodchain.blockscout.com/address/0xf3bee36ee9c798a3fbf55837b13c4e09d6a02c73) | 29,915,741 | 0.000628948538784000 |
| fourbit-weights-0311 | [0xfbbce1e6154edd89f3550ae930e9e2bd8feb2997](https://robinhoodchain.blockscout.com/address/0xfbbce1e6154edd89f3550ae930e9e2bd8feb2997) | 30,029,652 | 0.000655006769424000 |
| fourbit-weights-0312 | [0xb5c874c2fee11dc2a0fc4fe0f8bcb493c00c0082](https://robinhoodchain.blockscout.com/address/0xb5c874c2fee11dc2a0fc4fe0f8bcb493c00c0082) | 29,913,785 | 0.000630821898080000 |
| fourbit-weights-0313 | [0x0087dbb28ca333ba4aed35d521b801f3265bc2f7](https://robinhoodchain.blockscout.com/address/0x0087dbb28ca333ba4aed35d521b801f3265bc2f7) | 30,009,897 | 0.000647613577260000 |
| fourbit-weights-0314 | [0xa45d542d432984834c02ca427faaf6287bd85043](https://robinhoodchain.blockscout.com/address/0xa45d542d432984834c02ca427faaf6287bd85043) | 29,920,148 | 0.000633828415232000 |
| fourbit-weights-0315 | [0x8cf8753f9613078cc7f3ce963cd142b2397d60cd](https://robinhoodchain.blockscout.com/address/0x8cf8753f9613078cc7f3ce963cd142b2397d60cd) | 29,943,670 | 0.000630853239560000 |
| fourbit-weights-0316 | [0xb9579b34f4bf2229543a42e4745bb9f402e65292](https://robinhoodchain.blockscout.com/address/0xb9579b34f4bf2229543a42e4745bb9f402e65292) | 29,992,437 | 0.000654914854332000 |
| fourbit-weights-0317 | [0x68b34ece1bbe547ae68d23160c52cd719fd8f0de](https://robinhoodchain.blockscout.com/address/0x68b34ece1bbe547ae68d23160c52cd719fd8f0de) | 29,916,195 | 0.000626504955690000 |
| fourbit-weights-0318 | [0xaff7c360e5cf613cd31c626c2223355a07dddb2c](https://robinhoodchain.blockscout.com/address/0xaff7c360e5cf613cd31c626c2223355a07dddb2c) | 29,915,235 | 0.000626963495130000 |
| fourbit-weights-0319 | [0x35f3dddda55feb8728ea57678cb071234197dabe](https://robinhoodchain.blockscout.com/address/0x35f3dddda55feb8728ea57678cb071234197dabe) | 29,913,737 | 0.000626214170358000 |
| fourbit-weights-0320 | [0xffa1aacc0ac035b5a2157edb28c3434c1a4d2e7b](https://robinhoodchain.blockscout.com/address/0xffa1aacc0ac035b5a2157edb28c3434c1a4d2e7b) | 30,006,189 | 0.000636791342958000 |
| fourbit-weights-0321 | [0x2fd2b75f85d0aba583556d150d92a79fc4aa1902](https://robinhoodchain.blockscout.com/address/0x2fd2b75f85d0aba583556d150d92a79fc4aa1902) | 29,876,541 | 0.000630156002772000 |
| fourbit-weights-0322 | [0x76e4748aafa85b261f68112875cba0c329a8f841](https://robinhoodchain.blockscout.com/address/0x76e4748aafa85b261f68112875cba0c329a8f841) | 32,658,239 | 0.000687325297994000 |
| fourbit-weights-0323 | [0x7aacac1e8d264e086cf4bf8213ac04adb2c594a1](https://robinhoodchain.blockscout.com/address/0x7aacac1e8d264e086cf4bf8213ac04adb2c594a1) | 32,655,141 | 0.000686411063820000 |
| fourbit-weights-0324 | [0x1b68bccdf8166fc2ac8731d9c3d26e8c9f448b96](https://robinhoodchain.blockscout.com/address/0x1b68bccdf8166fc2ac8731d9c3d26e8c9f448b96) | 32,656,314 | 0.000687415409700000 |
| fourbit-weights-0325 | [0xcdf8fe44cf01bd1defbc779923a797dd0e4a02c1](https://robinhoodchain.blockscout.com/address/0xcdf8fe44cf01bd1defbc779923a797dd0e4a02c1) | 32,646,440 | 0.000687599319280000 |
| fourbit-weights-0326 | [0xbcad8acc9e8c864b6fd794a6fff588c9e43856a5](https://robinhoodchain.blockscout.com/address/0xbcad8acc9e8c864b6fd794a6fff588c9e43856a5) | 32,729,971 | 0.000692828026128000 |
| fourbit-weights-0327 | [0xaf9ea8f61537745a61866e2cc71ca6f313e8a64b](https://robinhoodchain.blockscout.com/address/0xaf9ea8f61537745a61866e2cc71ca6f313e8a64b) | 32,551,089 | 0.000704926383384000 |
| fourbit-weights-0328 | [0x55c3fd878c40c98da8aac28f3d7acbfc81ff6361](https://robinhoodchain.blockscout.com/address/0x55c3fd878c40c98da8aac28f3d7acbfc81ff6361) | 32,756,051 | 0.000685846195838000 |
| fourbit-weights-0329 | [0x402094dd39fee3dbb0f105b760bbe7a63310e943](https://robinhoodchain.blockscout.com/address/0x402094dd39fee3dbb0f105b760bbe7a63310e943) | 32,645,568 | 0.000683532902784000 |
| fourbit-weights-0330 | [0x2014082c548167d7aa1c1e147fd2e88f15fc5bbe](https://robinhoodchain.blockscout.com/address/0x2014082c548167d7aa1c1e147fd2e88f15fc5bbe) | 32,730,214 | 0.000685305220732000 |
| fourbit-weights-0331 | [0x3012d3cb393f7a820f516141fd52e0fd3d65bd7e](https://robinhoodchain.blockscout.com/address/0x3012d3cb393f7a820f516141fd52e0fd3d65bd7e) | 32,630,442 | 0.000690525413604000 |
| fourbit-weights-0332 | [0x1d11ff3e446071ff8f257d34ffa29442eda365fe](https://robinhoodchain.blockscout.com/address/0x1d11ff3e446071ff8f257d34ffa29442eda365fe) | 32,730,318 | 0.000687991284360000 |
| fourbit-weights-0333 | [0x0893dda0ea6af8aec3d9f718d0c7015e764d0d4e](https://robinhoodchain.blockscout.com/address/0x0893dda0ea6af8aec3d9f718d0c7015e764d0d4e) | 32,609,490 | 0.000687734144100000 |
| fourbit-weights-0334 | [0x21cdf0f0cf318d230af83ce32765804a657d7b6f](https://robinhoodchain.blockscout.com/address/0x21cdf0f0cf318d230af83ce32765804a657d7b6f) | 32,646,385 | 0.000685051742840000 |
| fourbit-weights-0335 | [0x79c5bfa854c045b90134b7782cceac251104c504](https://robinhoodchain.blockscout.com/address/0x79c5bfa854c045b90134b7782cceac251104c504) | 32,624,322 | 0.000688503691488000 |
| fourbit-weights-0336 | [0x7a84206e0fec849b91156b466250451044f70a23](https://robinhoodchain.blockscout.com/address/0x7a84206e0fec849b91156b466250451044f70a23) | 32,625,584 | 0.000688856580576000 |
| fourbit-weights-0337 | [0x7ace689f1cf147934e68143cfbcdefb29c928763](https://robinhoodchain.blockscout.com/address/0x7ace689f1cf147934e68143cfbcdefb29c928763) | 32,688,956 | 0.000693332756760000 |
| fourbit-weights-0338 | [0x7c73c8a6aff70dda7bc317f5546b43e12175f890](https://robinhoodchain.blockscout.com/address/0x7c73c8a6aff70dda7bc317f5546b43e12175f890) | 32,509,627 | 0.000686668341494000 |
| fourbit-weights-0339 | [0x80fef56b7bf20627ab4df463f3b9e92619a8b467](https://robinhoodchain.blockscout.com/address/0x80fef56b7bf20627ab4df463f3b9e92619a8b467) | 32,651,199 | 0.000690181044462000 |
| fourbit-weights-0340 | [0xb85e3285a668835f751cc544caf2501233fa3214](https://robinhoodchain.blockscout.com/address/0xb85e3285a668835f751cc544caf2501233fa3214) | 32,638,435 | 0.000689715408420000 |
| fourbit-weights-0341 | [0xdd037ab4361b6627674c7d0f334f8390da045076](https://robinhoodchain.blockscout.com/address/0xdd037ab4361b6627674c7d0f334f8390da045076) | 32,726,336 | 0.000685485833856000 |
| fourbit-weights-0342 | [0x0d73ab4b04e1f1aea50a16bb795f579036a29a49](https://robinhoodchain.blockscout.com/address/0x0d73ab4b04e1f1aea50a16bb795f579036a29a49) | 32,653,374 | 0.000686308614732000 |
| fourbit-weights-0343 | [0xc72ba43ffca0d1eacf5284c666abdea2306b5ecb](https://robinhoodchain.blockscout.com/address/0xc72ba43ffca0d1eacf5284c666abdea2306b5ecb) | 32,663,893 | 0.000713248767548000 |
| fourbit-weights-0344 | [0x89c08846eff5354a0ca65fd2615e35c86cc7e37e](https://robinhoodchain.blockscout.com/address/0x89c08846eff5354a0ca65fd2615e35c86cc7e37e) | 32,622,899 | 0.000687690710920000 |
| fourbit-weights-0345 | [0xf637ac09fd25f81506260e1360ccb09baaa8fcb1](https://robinhoodchain.blockscout.com/address/0xf637ac09fd25f81506260e1360ccb09baaa8fcb1) | 32,744,606 | 0.000689404934724000 |
| fourbit-weights-0346 | [0xa36e9ee56eff284626ad688b5df14f1d26bf7288](https://robinhoodchain.blockscout.com/address/0xa36e9ee56eff284626ad688b5df14f1d26bf7288) | 32,649,387 | 0.000683939358876000 |
| fourbit-weights-0347 | [0x35b7bac2db36241d6602a0c39883bfc02e3f1ec7](https://robinhoodchain.blockscout.com/address/0x35b7bac2db36241d6602a0c39883bfc02e3f1ec7) | 32,622,433 | 0.000707906796100000 |
| fourbit-weights-0348 | [0x67d95e81ddb904b8a479b62c899b3a6b187e786e](https://robinhoodchain.blockscout.com/address/0x67d95e81ddb904b8a479b62c899b3a6b187e786e) | 32,617,266 | 0.000692334088116000 |
| fourbit-weights-0349 | [0x8c3487ab63715fcb9031cb4cecc3b86ca9158788](https://robinhoodchain.blockscout.com/address/0x8c3487ab63715fcb9031cb4cecc3b86ca9158788) | 32,709,652 | 0.000690435334416000 |
| fourbit-weights-0350 | [0x3e04c286618de32dfbc4c79318c0371cb5f53742](https://robinhoodchain.blockscout.com/address/0x3e04c286618de32dfbc4c79318c0371cb5f53742) | 32,617,751 | 0.000693061973248000 |
| fourbit-weights-0351 | [0xa8803d59d7fbc35971f45e9c5bafd578e25663cb](https://robinhoodchain.blockscout.com/address/0xa8803d59d7fbc35971f45e9c5bafd578e25663cb) | 32,532,329 | 0.000714540074156000 |
| fourbit-weights-0352 | [0x248cd141ec6defd2de6338adb82ec028595741de](https://robinhoodchain.blockscout.com/address/0x248cd141ec6defd2de6338adb82ec028595741de) | 32,263,721 | 0.000789622307754000 |
| fourbit-weights-0353 | [0xa41a2fb4fd799b16bc9fb415d43aea15e0418b00](https://robinhoodchain.blockscout.com/address/0xa41a2fb4fd799b16bc9fb415d43aea15e0418b00) | 32,201,027 | 0.000808503385916000 |
| fourbit-weights-0354 | [0xc27c308c8d9e9dbd7f05d46ea68625722807af82](https://robinhoodchain.blockscout.com/address/0xc27c308c8d9e9dbd7f05d46ea68625722807af82) | 32,692,520 | 0.000688962166480000 |
| fourbit-weights-0355 | [0x8b013ec3a7ae23a7ae5f4e0a25c424b63c2a99cf](https://robinhoodchain.blockscout.com/address/0x8b013ec3a7ae23a7ae5f4e0a25c424b63c2a99cf) | 32,531,202 | 0.000687579485472000 |
| fourbit-weights-0356 | [0x9fa60ea1c6efb26f081a0503e0fa8d5a255775f1](https://robinhoodchain.blockscout.com/address/0x9fa60ea1c6efb26f081a0503e0fa8d5a255775f1) | 32,688,202 | 0.000690963213876000 |
| fourbit-weights-0357 | [0x009df7396471da5972e79a64d5af76098093d541](https://robinhoodchain.blockscout.com/address/0x009df7396471da5972e79a64d5af76098093d541) | 32,750,700 | 0.000689205730800000 |
| fourbit-weights-0358 | [0x75edb096f3410c29724bc6b859b9a969a61ea76e](https://robinhoodchain.blockscout.com/address/0x75edb096f3410c29724bc6b859b9a969a61ea76e) | 32,619,931 | 0.000686975746860000 |
| fourbit-weights-0359 | [0x9c416e811c6c5be430b8a27a50514978982c41f7](https://robinhoodchain.blockscout.com/address/0x9c416e811c6c5be430b8a27a50514978982c41f7) | 32,661,579 | 0.000685239927420000 |
| fourbit-weights-0360 | [0x27e021ac2e17246a989172900a1cbd3611095572](https://robinhoodchain.blockscout.com/address/0x27e021ac2e17246a989172900a1cbd3611095572) | 32,584,843 | 0.000683108648652000 |
| fourbit-weights-0361 | [0x27303c74b73a6b64a7d4fbe0c1b7e41fdfb51fd3](https://robinhoodchain.blockscout.com/address/0x27303c74b73a6b64a7d4fbe0c1b7e41fdfb51fd3) | 32,629,211 | 0.000688345835256000 |
| fourbit-weights-0362 | [0xbba07ed20a1ca40ca97bb695f7836fecffc50293](https://robinhoodchain.blockscout.com/address/0xbba07ed20a1ca40ca97bb695f7836fecffc50293) | 32,717,021 | 0.000690656313310000 |
| fourbit-weights-0363 | [0xd0fa89e23500035c56e334ad7cbe7a650af72ec7](https://robinhoodchain.blockscout.com/address/0xd0fa89e23500035c56e334ad7cbe7a650af72ec7) | 32,643,350 | 0.000685771496800000 |
| fourbit-weights-0364 | [0x286db8bfed87f72714f46955406ec0e773a09488](https://robinhoodchain.blockscout.com/address/0x286db8bfed87f72714f46955406ec0e773a09488) | 32,719,759 | 0.000686918620446000 |
| fourbit-weights-0365 | [0x95d63448b9cd3d132a46e241707cef05cda554ba](https://robinhoodchain.blockscout.com/address/0x95d63448b9cd3d132a46e241707cef05cda554ba) | 32,634,788 | 0.000689507800864000 |
| fourbit-weights-0366 | [0x851b33c00f69007dcdbec60414a91e0c8f61a87a](https://robinhoodchain.blockscout.com/address/0x851b33c00f69007dcdbec60414a91e0c8f61a87a) | 32,613,064 | 0.000697006403808000 |
| fourbit-weights-0367 | [0x3f72b1b8f155dda3bc257efe9c29533e9483707d](https://robinhoodchain.blockscout.com/address/0x3f72b1b8f155dda3bc257efe9c29533e9483707d) | 32,604,250 | 0.000697013656500000 |
| fourbit-weights-0368 | [0x3ce154975c585267d726ef8b1d65a162a53cbbb2](https://robinhoodchain.blockscout.com/address/0x3ce154975c585267d726ef8b1d65a162a53cbbb2) | 32,645,400 | 0.000686532762000000 |
| fourbit-weights-0369 | [0x116bbedc61ff291eeecb350cada7de1051aaa654](https://robinhoodchain.blockscout.com/address/0x116bbedc61ff291eeecb350cada7de1051aaa654) | 32,643,189 | 0.000685572255378000 |
| fourbit-weights-0370 | [0xea14216f474bcbbbe593c8357093eceb2fffe3c4](https://robinhoodchain.blockscout.com/address/0xea14216f474bcbbbe593c8357093eceb2fffe3c4) | 32,637,366 | 0.000686429081712000 |
| fourbit-weights-0371 | [0xb78c55e42d05735f515726403113ac50f011ec5c](https://robinhoodchain.blockscout.com/address/0xb78c55e42d05735f515726403113ac50f011ec5c) | 32,673,726 | 0.000686148246000000 |
| fourbit-weights-0372 | [0xb126e409496f0767c2f93a94b26e007e8112026a](https://robinhoodchain.blockscout.com/address/0xb126e409496f0767c2f93a94b26e007e8112026a) | 32,551,432 | 0.000684035792048000 |
| fourbit-weights-0373 | [0x22d1e96b45d1d818f1739a1cbf4a0889a8fa1751](https://robinhoodchain.blockscout.com/address/0x22d1e96b45d1d818f1739a1cbf4a0889a8fa1751) | 32,695,245 | 0.000688234907250000 |
