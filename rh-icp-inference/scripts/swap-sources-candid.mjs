import fs from "node:fs";
import { loadSources } from "../worker/swaps.mjs";
const registry = JSON.parse(
  fs.readFileSync(new URL("../swap-sources.json", import.meta.url), "utf8"),
);
const pools = loadSources(registry, registry.chain_id);
const rows = pools.map(
  (pool) =>
    `record { manager = ${JSON.stringify(pool.manager)}; pool_id = ${JSON.stringify(pool.pool_id)}; currency0 = ${JSON.stringify(pool.currency0)}; currency1 = ${JSON.stringify(pool.currency1)}; fee = ${pool.fee} : nat32; tick_spacing = ${pool.tick_spacing} : int32; hook = ${JSON.stringify(pool.hook)} }`,
);
console.log(`opt vec { ${rows.join(";\n")} }`);
