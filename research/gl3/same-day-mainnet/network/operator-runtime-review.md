# Independent operator-runtime review

Actual tested helper: `ops/prepare-operator-runtime.mjs`, SHA256 `37ebf3afa08d4d9065377acac832b8976bd4443e9a9fc6bcde68586d5a535629`.

On Runpod, 13 checks passed across 14 child processes using newly generated, unfunded TEST roles only. CPU affinity was restricted to two logical CPUs; peak child RSS was 198,248 KiB. The test never read production `operators.json`; a child filesystem guard rejected every mainnet-path access, and its observed attempt count was zero. No transaction was signed/submitted, no service started, and generated private TEST material was removed.

Verified actual ethers V3 encryption/decryption and exact private-key/address roundtrip; keystore/password/JWT/report0600 and directories0700; prepare/render no-overwrite behavior; wrong role/address, backup hash, unverified off-pod receipt, nonprivate input and incorrect genesis hash rejection; and effective private URL/password reference rendering without those values in argv/stdout/stderr. Final negative cases verified testOnly production-namespace rejection before access, root/private-parent symlink rejection, and output-config symlink/permissive-directory rejection.

Backup tests covered reference/hash/verified-receipt gates with a synthetic TEST backup blob. They do not establish age decryption or actual off-pod production recovery. The test did not inspect or unlock a production role, verify a live chain receipt or launch a node.

Two source findings were reported to root before changes: the original testOnly namespace was too broad, and output config-directory canonical/private checks were absent. Root owns the helper and applied both fixes. The earlier helper `b439df94929eae8021e26baf5ab0e251eb52a7c5da8742c9a7158517a0a65201` reproduced the output-directory symlink placement failure after 11 other cases passed. That failure is retained in `evidence/operator-runtime-validation-attempt03.log`; all material source tests passed against the final hash above.

Earlier launcher/fixture failures are preserved separately: attempt01 was a Python payload-substitution syntax error before Node execution; attempt02 exposed a TEST backup buffer being JSON-serialized instead of written as raw bytes. Both were harness corrections, not helper failures or production operations. `test_operator_runtime.mjs` contains the final bounded reproducible test. Its stdout deliberately omits private values, and its negative mainnet-namespace case stores the spec under the fresh TEST root, never under mainnet.

This review applies to the exact tested source hash. Compare the helper before real key assembly if it changes. No edits to root's helper were made by this subtask.
