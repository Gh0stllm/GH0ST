# GL3 · Complete-decision challenge input

[Production acceptance](README.md) · [Recorded input manifest](evidence/terminal-input-manifest.json) · [Full-decision result](evidence/terminal-full-decision-capture.json)

An actual private Nitro node completed the unchanged 24-million-node decision, producing e7e5 /24,000,033 /depth 38 and the pinned complete canonical state. It posted the final computing block in an actual private parent batch and exported that block's complete validation input. The fixture completed in 402.65 seconds; terminal recording took 34.05 seconds. This captures the **completed result**, rather than only the first pending-search block.

| Captured value | Evidence |
| --- | --- |
| Terminal compute transaction | `0x8d3a512d1caa3a125d14ed52d5638fa5a4d774f3eb30afdc1ac58540dc6dd4c9` |
| Child block | 4,917 |
| Block hash | `0x8d33a6345311761aef5c7ee9e5528350f17beda843d0563cfdd103aeec70d738` |
| Private parent batch / block | 2,469 /2,500 |
| Complete recorded input | 2,574,999,906 bytes |
| Input SHA-256, independently checked after recording | `bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90` |
| Expected end block hash | Same as terminal child block above |
| Expected end send root | All zeros |
| Expected end batch / position | 2,470 /0 |
| Matching custom machine root | `0xd45324627b0b3118dfdf1ad585769024cfa6008da8cdcaa745de32edc724613b` |

The raw input remains a private cloud artifact. Its manifest and verified digest are published here; multi-gigabyte preimages are not added to Git. Capturing this input is not a completed interpreter replay or an actual wrong-result BoLD challenge.

**Independent replay of this captured terminal block failed.** The `d453…` guest exited 1 after 2,153.85 seconds with guest heap exhaustion during historical state restoration; the expected final state was not reached. The 128 GB host was not out of memory. [Failed replay evidence and current blocker](../dispute/README.md#final-block-replay-failed-acceptance-remains-blocked). The native capture below remains a valid completed recording, but neither it nor early-block replay passes establish production acceptance of the terminal result.

The actual process exit code was zero. A replacement observer paused only the original metrics collector while the Go test and all chain/engine processes continued. It read the exited child's real kernel wait status before reaping, saved it before optional metric reads, and resumed the original collector. That repair and the late attachment are preserved explicitly. [Exit status](evidence/terminal-capture-exit.json) · [Observer attachment](evidence/observer-attachment.json) · [Complete test log](evidence/terminal-capture.log.gz).

Kernel process high-water RSS was 17,437,816 KiB; it covers the entire Go-test process lifetime despite the observer attaching late. The sampled cgroup interval is late and includes other pod work. The v1 whole-pod peak was 27,440,050,176 bytes on the 128 GB worker; it is not a hard 32 GB or node/prover coexistence acceptance. [Resource scope](evidence/terminal-resources-summary.json).

The multi-gigabyte input is also a concrete storage/proof-operability consideration. Long-history bounds and safe checkpoint/reclamation remain required; this one-decision capture does not establish capacity for 20 complete games.
