# Completed portable image export

**Native replay and export passed. This is not a WAVM proof result.**

The isolated exporter replays the same recorded terminal compute block as the
selected `865168…f086` guest. It then cold-restores the completed job through the
existing authenticated seed/delta reader and saves its committed portable memory
and globals **before** calling the canonical serializer. The export helper calls
neither `Begin` nor `Advance`; the prerequisite replay executes the recorded final
compute transaction. It starts no new game or full decision.

All compilation and execution ran on the existing Runpod worker. The selected
guest, companion, original input, active interpreter and baseline source were
unchanged. The added helper is native-only and requires a dedicated acceptance
build tag.

| Check | Observed result |
| --- | --- |
| Native process | Exit 0, 12.09 seconds |
| Recorded block / receipt / gas | Exact reference match, 12,306,935 gas |
| Four final global-state fields | Exact reference match |
| Completed result | `e7e5`, 24,000,033 nodes, depth 38 |
| Portable memory | 466,157,568 bytes, SHA256 `26ade604551c291ab4d6e2194dbf45a4cfb8f895d914443d3740ac55422a92f7` |
| Portable image root | `c7831793f32eb194d7cd96411c8588cd9907d1e7d6875b48e9996c4623e948d3` |
| Final ordinary delta | 6,272 bytes, SHA256 `8abd2b02f3f3f708f3f5d94242587493dd2bde6c888a4ec023119c8e1a1973ab` |
| Delta count / generation | 2,464 / 2 |
| Canonical serialization | 163,085,439 bytes, original SHA256 `5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6` |

The canonical serialization is a separate artifact; it is not substituted for
the portable checkpoint image. The original recorded input contains the
**preterminal** 2,463-delta state, which is also distinct from this export.

The small [`export/`](export/) metadata includes exact final and seed metadata,
globals, authenticated final delta body, its sole code fragment and address/code
hash, and native receipt facts. Large memory/canonical binaries remain private
on the worker under `/root/bounded-restore/final-state-export/export/`; hashes and
sizes are in [`export-manifest.json`](export-manifest.json). The checkpoint lane
can use these bytes with the immutable original preimages without rerunning a
game.

[`run.py`](run.py), the [native command](native/cmd/gl3replayexport/main.go) and
[acceptance helper](native/precompiles/gl3_checkpoint_export.go) reproduce the
export from the prepared source/runtime and materialized original inputs.
[`source-manifest.json`](source-manifest.json) records source/tool/input identity
and verifies copied consensus files against the selected native candidate.
[`run-exit.json`](run-exit.json) and [`run.log`](run.log) retain the actual result.

This evidence does not establish crash recovery, checkpoint consensus safety,
challenge completion, long-game storage bounds or production readiness.
