# From allocator research to a sound new STF

This plan does not authorize deployment, migration, pruning or disposal.
Selected865 and the active dispute stay unchanged.

## Minimal production layout

Choose a new profile/version/address domain and one fixed bank for the current
single admitted game. Keep the immutable seed/model available once. Address
cells by bank/page index; use bounded descriptor/epoch/presence metadata. Feed
the **unchanged engine's authenticated dirty pages**, exact portable memory,
globals, pending control state, full TT and history into normal journaled writes.
Never accept user-declared page bytes or a claimed image root as execution proof.

For ongoing decisions, preserve epoch and all prior VM state. A new game may
change epoch according to the existing new-game initialization policy. Preserve
zero overrides of nonzero seed pages. Use the existing full-image commitment
scheme; this prototype's window hash is not a substitute.

Ordinary StateDB code reads/writes initially avoid the accessor explicitly
restricted to immutable seed/history. Reserve writer authority and reject
unexpected code identities. Do not reset nonces, burn donations, self-destruct,
or assume a funded account becomes empty. A finite address set bounds residue.
Native caches must include authoritative backing/epoch identity and use
authenticated cold fallback after reorg/copy/recording/rollback drift.

## Migration choices

Fresh new-profile games can initialize from the fixed verified seed. Existing
A14/A15 states require a separate authenticated migration, with the exact source
module/root/owner/job/generation frozen until completion. Build and verify bounded
pieces without trusting a native cache; cold-path work must also be metered.
Atomically switch authority only after complete memory/global/root equality.
Interruptions must retain a valid old source or a completely verified new bank.

The legacy A14/A15 accounts remain current code until explicitly retired. If
retirement is used, authenticate complete blob dependencies and track sharing
across jobs, profiles and pending builders. Do not clear a shared or resurrected
blob. Preserve balance/nonce/storage and a separately budgeted legacy backlog.
The small allocator does not implement this retirement machinery.

## Separate current-state and historical-disk gates

A whole runtime still has at most 196,608 4 KiB pages at the unchanged 768 MiB
ceiling. At this prototype's 54-byte header, arithmetic gives 815,923,200 cell
bytes per bank, before descriptor, seed, trie/account overhead and legacy data.
The implementation currently caps at 256 pages; this is not a tested whole-bank
limit. Twenty banks would be a new admission/product design, not a consequence
of that arithmetic.

Overwritten code versions and old trie roots remain historical requirements.
Pin all dependencies for canonical/unfinalized/fallback states, permitted
reorgs, open assertions and challenges, plus actual recovery/response windows.
Build a hash-indexed durable archive, independently reconstruct from it, prove
response times, and make required data available to challengers. Only then can
a separate reviewed physical-pruning policy remove unneeded local versions.
The twenty local in-memory historical roots tested here establish no public
archive or crash/disk durability.

## Required acceptance before replacing the storage gate

1. Complete real-image bank/seed round trip and native continuation with exact
   original canonical TT/history, quality parameters and all portable globals.
2. Pending-search snapshots and continuation; zero overrides, memory growth,
   OOG/trap/outer rollback, crash/reorg/copy/recording and stale-cache tests.
3. Source-backed bounded cold operations, gas tariff, account/metadata limits,
   shared A14/A15 admission and owner/epoch/generation authorization.
4. New guest/root replay with actual exit, exact native header/gas/all-four end
   fields, authentic witnesses and full inherited OSP/manager/dispute settlement.
5. Persisted representative multi-decision DB growth with distinct positions,
   measured dedup/amplification, archive/rebuild challenge tests and explicit
   512 GB/1 TB reserve. No twenty-game pass from a four-page allocator.

The original measured first-decision storage and its 1,600-decision planning
envelope remain the current capacity evidence until these gates pass.
