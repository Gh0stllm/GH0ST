# Forge website release

The creator interface is published under `/forge/` on the existing GH0ST Netlify site, with one added homepage link. Build using `npm ci` and `npm run build` from `research/forge`. The output is `frontend/dist/forge`.

A deployment of that partial directory alone would omit the other GH0ST applications. Merge only the Forge paths and reviewed homepage change into the complete current site manifest. Preserve all unrelated file digests, function digests/configuration, aliases, headers, redirects and schedules. Public output filenames are lowercase, including `forgemodel.sol` and font licenses, to match Netlify file inventory normalization.

The release used a ready unpublished preview before creating a new production snapshot. The final full manifest, 46 HTTP routes/assets, existing backend functions and mint alias were checked. [Public release evidence](../results/web-release.json) records the exact asset digests and deployment.

No project wallet transaction or existing ICP canister update is needed for the site. Creators explicitly approve their own native-gas model deployment. Solidity and payment flow evidence is labeled as isolated simulation until a specific creator supplies a canonical mainnet transaction.
