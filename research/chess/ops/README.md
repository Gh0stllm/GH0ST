# Read-only checks and launch costs

Run `node ops/read-bindings.mjs` from `research/chess` to check chain 4663 first,
then canonical GH0ST's code and 18 decimals at one fixed block. `--write` saves a
public snapshot. The endpoint can come from the private local
`ROBINHOOD_MAINNET_RPC_URL`; neither the endpoint nor provider bodies are printed.
The script has no signer and sends no transactions. A saved snapshot is historical
evidence and must be refreshed before deployment.

No chess canister or prize vault has been publicly created, deployed, funded or
enabled. Existing GH0ST model, service and bounty balances are not a chess budget.
Before paid launch, complete the entry verifier and result signer, run an integrated
game, calibrate a robust fixed search budget, and review exact canister controllers,
immutable pool owner/attestor, release hashes and operating spend. Funded games
must never be switched to a cheaper or weaker engine configuration.

## Compute planning only

As checked on 2026-11-15, the [official ICP cycle costs](https://docs.internetcomputer.org/references/cycle-costs/)
list 1 cycle per instruction plus a 5,000,000-cycle update base fee on a 13-node
application subnet. One trillion cycles equals one XDR; the documentation's USD
illustration uses $1.366430/XDR. Subnet scaling and the exchange rate can change.

The measured 500k-node cold opening used 29.804 billion instructions on the earlier
wrapper; the final cold tactical case used 28.022 billion. At the listed 13-node
rate these are about 0.030 and 0.028 XDR of search compute, roughly $0.041 and
$0.038. An illustrative 40-bot-move game at the cold-opening count would be about
1.19 XDR ($1.63) in search compute alone. This is a scenario calculation, not a
measured whole-game bill or a bound for every position.

This excludes authority work, continuation overhead, ingress/response bytes,
RPC outcalls, signing, memory, installation, reservation and RH gas. Production
`key_1` ECDSA signing is separately listed as 26,153,846,153 cycles. Canister creation
is listed as 500 billion cycles each on a 13-node application subnet. Those tables
do not establish an ICP-token spending amount; conversion and actual target subnet
must be checked for the final deployment plan.

At the user's fixed token terms, completed non-refunded games change the pool by
`25,000 - 100,000 × player_checkmate_rate` GH0ST per game on average. The 25 percent
break-even point excludes all hosting/network costs and assumes no other token
flows. No adversarial engine-versus-engine win-rate or profitability measurement
has been completed. Top-ups remain voluntary and manual.
