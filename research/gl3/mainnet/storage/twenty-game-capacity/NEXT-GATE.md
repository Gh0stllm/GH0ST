# Smallest sound persistent-layout change

**Design/acceptance plan, not a selected-machine change or production migration.**

Use a new explicitly versioned profile with one fixed page bank for the current
single active game. Retain the exact unchanged full-strength VM state. A future
20-active-game product needs a fixed bank per admitted state plus a shared heavy
execution queue; it is a separate protocol/admission decision.

1. Derive cell addresses from fixed profile/bank/page index, never content hash,
   job, generation or epoch. Reuse a bounded descriptor and bitmap. A new game
   changes an authenticated epoch; continuing decisions keep complete TT/history.
2. Authenticate every present cell's profile/bank/epoch/page and exact bytes.
   Missing referenced cells fail. Zero overrides must not fall back to a nonzero
   seed. Check complete memory/globals/image commitment on cold restoration.
3. Journal changed page code, bitmap and descriptor atomically with each normal
   engine slice. Keep existing gas/heavy-work controls until measured replacements
   are independently reviewed. Use ordinary StateDB readers for mutable cells;
   immutable-only seed/history accessors are not automatically valid for them.
4. `SetCode` must preserve donations, balances, nonces and unrelated storage.
   No self-destruct, nonce lowering, balance burning or assumption that an old
   account becomes empty. A fixed finite address set makes account residue bounded.
5. Bind native accelerators to the exact authoritative backing/epoch/descriptor,
   not image root alone. Reorg, outer rollback, recording and cache copies must
   use authenticated cold fallback when identities drift.
6. Count the legacy backlog separately. Fixed cells do not remove old A14/A15
   blobs. Migration must authenticate source roots/bytes and switch atomically.
   Retirement, if chosen, needs cross-job/profile/build references and safe
   resurrection handling before clearing any owned code.

At the unchanged 768 MiB runtime ceiling and 4 KiB pages, one bank has at most
196,608 cells. The earlier illustrative 128-byte cell-header allowance gives
830,472,192 code bytes per bank; 20 banks would be 16,609,443,840 bytes. These
are **layout arithmetic**, excluding seed, trie/account overhead, metadata,
legacy backlog and history. They are not measured production disk bounds.

Overwriting code only bounds current references. Historical code hashes, old
trie roots, batches and witnesses remain necessary for unfinalized states,
reorg recovery and every open BoLD claim/dispute. Before physical pruning,
demonstrate a hash-indexed available archive, independent reconstruction and
response time inside actual challenge deadlines. A server-local file is not
proof of public challenger availability.

Required gates, before any twenty-game acceptance:

* Native StateDB/EVM allocator tests: fixed account count across repeated writes,
  exact cell reconstruction, funded/nonzero-nonce cells, OOG/trap/outer rollback,
  missing/corrupt backing, ABA/reorg/copy/recording and cache identity.
* Complete unchanged VM/native canonical equality on actual completed and
  suspended states, including TT/history, with real cold restore and continuation.
* New guest/root replay with exact all-four end fields, gas/header agreement,
  authentic witnesses, inherited OSP/manager boundaries and full dispute closure.
* Persistent DB/code/history growth over representative distinct positions,
  with measured amplification and dedup; explicit 512 GB/1 TB operating reserve.
* Historical-retention/rebuild challenge test, independent archive recovery,
  interrupted migration/retirement recovery and accepted disposal policy.
* A separately tested admission/product plan if twenty states must be active
  simultaneously. Current one-game admission is not such a plan.

Selected865 remains unchanged. Root will treat a small allocator prototype as
supporting research only, never as a completed 1,600-decision capacity test.
