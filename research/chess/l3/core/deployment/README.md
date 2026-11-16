# Core deployment preparation

`intent.json` proposes GH0ST chain4663001 on Robinhood4663, with the existing project owner, native GH0ST gas, standard ArbOS61/Stylus and the official consensus-v61 module root. The chain ID was absent from the checked public list; this is a proposal, not a reservation. No public rollup, RPC or genesis is created by these files.

`prepare-config.mjs` bundles only the pinned SDK's pure chain-configuration and consensus-root helpers. It creates no provider, account, signer or transaction. It keeps ordinary code/initcode limits and disables debug precompiles. The generated chain configuration is only one part of `createRollup` parameters: operator accounts, factory, fee-token pricer/rate, validator stake/security, parent timing, licensing and hosting remain explicit review gates. The program never calls the SDK's signing/deployment workflows.

```sh
python3 research/chess/l3/core/deployment/fetch-sdk.py
node research/chess/l3/core/deployment/prepare-config.mjs
```

The source commit is pinned separately from the published package's version number. Cached source and generated helper code remain ignored. `evidence/sdk-config.json` records the exact source hashes and the proposed configuration hash. `local-factory/` contains the separate synthetic-parent contract rehearsal and its limitations.

Robinhood has no canonical factory listed in the current official table. A self-deployed factory is an unsupported upstream path and must be rehearsed and reviewed, not treated as an already supported network. The current license also requires the appropriate AEP arrangement for a parent other than Arbitrum One or Nova. No license was accepted and no funds were spent. [Factory documentation](https://docs.arbitrum.io/launch-arbitrum-chain/deploy/canonical-factory-contracts), [licensing](https://docs.arbitrum.io/launch-arbitrum-chain/overview/license).
