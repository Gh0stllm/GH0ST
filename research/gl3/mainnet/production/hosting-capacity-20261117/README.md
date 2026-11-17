# GL3 hosting and retained-capacity quotes — 17 November 2026

**Status: capacity/price research only; production host not accepted or purchased.**

There are available dedicated-server configurations with enough physical storage
near the $100/month preference. None of the reviewed offers establishes a
tax-inclusive, performance-accepted GL3 production fit. The lower-cost choices
use HDDs and older CPUs; no quoted clock is a sustained-clock guarantee.

This packet uses official public catalogs, a live auction feed, provider billing
documentation, and Intel specifications. It performs no GL3 execution, builds,
benchmarks, provisioning, purchases, credential access, or mainnet calls.
All workload tests remain restricted to the existing Runpod machine.

## Capacity basis and reserve

The [measured storage envelope](../../storage/twenty-game-capacity/evidence/twenty-game-envelope.json)
projects **2,590,479,821,224 bytes / 2.59048 decimal TB of immutable code** for
20 games × 80 Black decisions at the observed first-decision rate. That is an
extrapolation from one measured completed decision, before database/history/proof
overhead. It is not a 20-game execution result. Current-head code is still
referenced, so no quote assumes that old code can move to cold archive or be
pruned. Current admission remains **one active game**.

For comparison, reserve 20% of the mirrored disk capacity and another 100 GB for
the OS and non-workload system use. These are planning allowances, not measured
filesystem free space:

| Installed drives | Raw capacity | RAID1 nominal capacity | After 20% reserve and 100 GB OS allowance | Space above the code-only projection |
| --- | ---: | ---: | ---: | ---: |
| 2 × 6 TB HDD | 12 TB | 6 TB | 4.7 TB | 2.10952 TB |
| 2 × 8 TB HDD | 16 TB | 8 TB | 6.3 TB | 3.70952 TB |

Both leave at least 4 TB for workload data under this allowance. Filesystem and
RAID metadata still reduce nominal capacity. A provider's two-drive listing does
not itself establish an installed or healthy mirror; deployment must configure
and verify it. Two 4 TB drives would give only one nominal 4 TB mirror and about
3.1 TB under the same allowance, so they are excluded.

The full-volume backup comparison uses a **10 TB Hetzner BX31 at $24/month**,
with 8 TB remaining after a separate 20% backup-space reserve. This is space for
one retained dataset plus limited change history, not two independent full
images or an accepted retention schedule. The backup service is separate from
the compute host and provider for the SERVER4YOU candidates. No automatic backup
or restore integration has been implemented or tested by this packet.

## Three concrete candidates

Prices below use providers' native USD lists, with Linux, one IPv4 and the 10 TB
backup allowance. They exclude unverified taxes/payment conversion charges and
all parent-chain execution, DA, staking or other non-hosting costs. Exact
observed availability and source hashes are in
[dated quote evidence](2026-11-17-quotes.json).

| Candidate | RAM and CPU | Storage | Available at capture | Monthly compute + IPv4 + 10 TB backup | Decision |
| --- | --- | --- | --- | ---: | --- |
| SERVER4YOU E-2146G | 64 GB DDR4 ECC; 6 cores/12 threads, 3.5 GHz base, up to 4.5 GHz turbo | 2 × 6 TB SATA HDD | Strasbourg: few left | $49.99 + $0 + $24 = **$73.99** | Best price/capacity headroom; falls below the desired 5 GHz and has no accepted GL3 timing or HDD result |
| SERVER4YOU E-2286G | 64 GB DDR4 ECC; 6 cores/12 threads, 4.0 GHz base, up to 4.9 GHz turbo | 2 × 6 TB SATA HDD | St Louis: in stock; Strasbourg: few left | $74.99 + $0 + $24 = **$98.99** | Closer to desired clock; only $1.01 left for unknown tax/charges, so no confirmed all-in $100 fit |
| Hetzner auction **3113967** | 64 GB DDR4 non-ECC; i9-9900K, 3.6 GHz base, up to 5.0 GHz turbo | 2 × 8 TB Enterprise HDD | Listed in FSN1-DC14 live auction | $131 + $1.90 + $24 = **$156.90** | Meets desired advertised max turbo and capacity; exceeds budget before tax |

SERVER4YOU lists zero setup fees and a one-month minimum. The auction lists zero
setup fee; its stock and price are specific to a transient listing. Refresh the
same official sources before treating any offer as orderable. The two Xeon
models are older Coffee Lake CPUs with AVX2. Neither their maximum turbo numbers
nor a modern GPU/Runpod host's result proves sustained single-thread GL3 speed.

Within the E-2286G family the available 2 × 8 TB variant costs $79.99, just $5
more: **$103.99** with the 10 TB backup. A smaller **5 TB BX21 backup costs
$13/month** and gives $87.99/month for the 6 TB variant or $92.99/month for the
8 TB variant. After reserving 20% of that backup quota, its protected-data budget
is only 4 TB: the code projection leaves **1.40952 TB** for database, histories,
proofs and retained changes. It cannot back up a full 6 TB or 8 TB live volume.
This narrower backup envelope is a possible cost tradeoff, not an accepted
full-volume backup design.

## Tax and billing boundary

The SERVER4YOU public catalog does not establish the tax treatment for this
user's billing address. Its public order endpoint returned an error during this
read-only review; no address/account was submitted. Do not label $73.99 or $98.99
as the user's final bill. The $73.99 configuration leaves $26.01/month for tax
and other hosting charges; the $98.99 configuration leaves $1.01.

Hetzner's official [VAT policy](https://docs.hetzner.com/general/billing-and-account-management/billing-at-hetzner/value-added-tax/)
says customers in other non-EU countries outside its listed exceptions receive
invoices without VAT; India is not in the exceptions in the captured source.
That describes the provider's invoicing policy, not a determination of the
user's domestic tax obligations. Account currency is chosen at creation and
cannot subsequently be changed; these USD amounts assume a USD account.
Payment-provider/FX fees and the user's actual billing profile are unverified.

## RAM, speed, recovery and failure domain

The selected terminal-block reference recorded **25,492,628 KiB / about
24.31 GiB maximum child RSS** in the existing
[replay result](../bounded-restore/scheduling/comparison/C-combined/interpreter/replay-result.json).
That single process peak does not accept a co-hosted 64 GB machine. Node state,
page cache, database compaction, sequencer/batch work, proof generation and
recovery can overlap. A hard-limit co-hosted acceptance run on existing Runpod
is still required. No quote changes Stockfish's 24-million-node search,
98.5 MB NNUE, Hash 128 MiB, Threads 1, retained TT/history, or proof machine.

All three listed shapes have HDD-only active storage. Keeping the live database
on HDD is a meaningful open performance question: random state/code reads,
compaction, proof input and recovery must be measured. No proposal silently
moves current-head referenced code to a remote filesystem or cold archive.
The current Hetzner add-on list charges **$114/month for each 3.84 TB NVMe DC
drive**, excluding VAT, and explicitly makes model/location availability
conditional. It is not evidence that a cheap base server can become a cheap
mirrored multi-TB SSD host. No SSD-upgrade quote was established here.

A mirror tolerates one disk failure but leaves a single compute host. A host,
controller or site outage stops this one-host sequencer/RPC/prover service until
repair or replacement and restore. Backup capacity does not supply a warm
replacement, failover sequencing, a tested restore time or a zero-downtime
claim. For scale, copying the code projection alone over a perfectly saturated
1 Gbit/s link has a theoretical lower bound of **5.76 hours**, before database
overhead, protocol loss, I/O, replay and verification. No end-to-end restore time
or uptime commitment for GL3 follows from this number. Hetzner Storage Boxes use
RAID but the provider states that data is not mirrored to other servers; a
backup box is therefore not by itself multi-site backup redundancy.

## Disposition

The E-2146G has the clearest price/capacity headroom; the E-2286G is closer to the
desired clock with a tight budget. Both remain research candidates. **No
reviewed shape establishes all of: accepted GL3 performance, hard 64 GB
co-hosting, measured full retained-data overhead, tested backup/restore,
tax-inclusive <= $100/month, and the desired 5 GHz class.** No host is selected
or ordered. Pricing cannot accept 20 games, production, or performance.

Primary source URLs and machine-readable facts are retained in
[2026-11-17-quotes.json](2026-11-17-quotes.json). All future GL3 tests/builds remain
on existing Runpod; this packet authorizes no resource changes.
