# SYNAPSE frontend

Standalone static application for `https://gh0st.fyi/synapse/`. Build output is confined to `frontend/dist/synapse/`; it does not replace another page of the GH0ST website.

```sh
npm install
npm test
npm run build
npm run test:app
npm run preview
```

Open `http://localhost:4178/synapse/`. The initial tracked deployment manifest is explicitly **unconfigured**. Local integer reference values remain inspectable, while public preview and all wallet payments stay disabled until the configured deployment passes verification. No private RPC or key is accepted by the browser.

The build reads model JSON and the actual compiled contract ABIs. `modelDirectory` and `artifactsPath` in `deployment.json` can select a versioned model/artifact directory, relative to this frontend. UI dimensions and integer reference math derive from the model metadata; fixed-array V1 and dynamic-array V2 contract shapes derive from the ABI. The same public RPC serves all reads.

## Deployment manifest

`schema`: `gh0st-synapse-deployment-v1`; `status`: `live` or `unconfigured`; `chainId`: `4663`; `chainName`; optional `rpcUrl` must equal `https://rpc.mainnet.chain.robinhood.com`; `explorerUrl`; `token`: `{address,symbol,decimals}`; `confirmations` (minimum 1).

`backbone`: `{address,spaceId,weightsHash,codeHash,beneficiary,fee}`.

`experts`: `[{id,name,address,spaceId,weightsHash,codeHash,beneficiary,fee}]`.

`graphs`: `[{id,name,address,graphId,totalFee,expertIds:[firstExpertId,secondExpertId],codeHash,transactionHash}]`. Order the original graph first and alternate graph second. Fee values use raw token units as decimal strings. Optional `proofs` are `[{label,url}]`; `repositoryUrl` links to the public source.

The browser verifies network ID, runtime code hashes, module representation/weight identity, beneficiaries, fees, graph composition, token decimals, and the quote. Public preview is compared with the published exact integer reference. A paid request supplies the quoted graph ID, an exact fee cap, and a deadline ten minutes after the latest chain block. Existing nonexact allowance is reset to zero through its own wallet action; a separate action approves exactly one token's fee. Approval never starts inference automatically.

Inference receipts must match the requested graph, payer, token, context hash, complete trace hash, and all three module activation/credit events. Confirmed receipts link to the explorer. Submitted transaction hashes persist locally; unresolved transactions block another payment until their receipts can be checked. Beneficiaries can inspect and explicitly withdraw their own graph credits.

The original and alternate experts are both authored by the same project. Module swapping proves compatibility, not independent contributor authorship. Free continuation stops at EOS or twelve reads. Paid inference always requires an explicit action for one next token.

## Verification

`npm test` checks the original fixtures plus all 52 final domain V2 fixtures, arbitrary context sizes, vocabulary rejection, manifest/quote constraints, and receipt validation failures. `npm run test:app` drives the actual production bundle with a simulated DOM, wallet, and intercepted RPC against locally deployed V2 contracts. It covers verification, the alternate expert, wrong-network blocking, wallet rejection, resetting nonexact allowance, exact approval, paid inference/trace/payment receipts, beneficiary withdrawal, and free continuation. It requires the parent research dependencies and compiled V2 artifacts. Its report is saved under the ignored `test-results/` directory. Browser QA covers the unconfigured desktop and 400-pixel layout, plus live public-RPC base and alternate previews on the published frontend. The production page was observed at 662 pixels without horizontal overflow. Simulated transaction hashes never establish public deployment or payment.
