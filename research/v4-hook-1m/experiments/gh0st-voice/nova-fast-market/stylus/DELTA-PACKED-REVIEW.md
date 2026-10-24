# Independent review: lossless delta storage + packed3 WASM

Reviewed source: `../kernels/wasm-packed/wasm/src/lib.rs`, SHA-256 `22614b3bef810cd0a7ed0eb4e1a4edc7d5924395677821210a392e7854bbf6b4`.

## Result

No arithmetic or read-bound defect was found in the reviewed fixed model format. The independent decoder in `review-delta-packed.py` imports neither the exporter nor Rust loader. It reconstructs each row from one little-endian bit string and compares it against the original selected `reference.npz`.

- All **4,523,904 dynamic matrix weights** match.
- All **8,325 head biases** match.
- All 128 word-group boundaries match the decoded positions exactly.
- The fused data, vocabulary, lookup tables, feature/recurrent-bias suffix and punctuation data match the original bytes or original quantized arrays.
- Every reconstructed triple satisfies the signed packed-dot bound; the maximum coefficient magnitude is 847,872, below 1,048,576.

The JSON evidence is `delta-packed-independent-review.json`. This review does not certify a production hook or measured chain throughput.

## Decoder and bounds

The minimum is parsed as a signed little-endian i16. The bit width is bounded to 0–16; the optional head bias preserves all signed i32 bits. The payload occupies exactly `48 × bit_width` bytes. The specialized 7/8/9-bit readers never read beyond that payload: even the last 9-bit value ends in its final two-byte window. Other widths use a bounded byte accumulator, and width zero performs no payload reads.

`BitStream::take` checks its requested length against both its 768-byte scratch capacity and the declared stream end. A contiguous slice remains valid while decoding because that decoder does not refill the stream. A boundary-crossing slice is copied into separate row scratch memory before decoding. Each 24,000-byte refill is itself split at physical code-shard boundaries. `finish` requires exact stream exhaustion.

Core decoding writes precisely 3,456 × 1,024 bytes, followed by 16,128 auxiliary bytes, into the 3,555,072-byte core array. Group, selected-word and punctuation rows write 1,028 bytes each into their correspondingly sized arrays. Word offsets are strictly increasing, start at 532, end at the known file size and are bounded again before each selected group read. The loader rejects short host reads, incorrect magic/counts, unsupported bit widths, non-i16 decoded values and triples exceeding its packed arithmetic bound.

## Remaining prototype limits

The local adapter uses virtual code addresses. On-chain catalog addresses and model/code hash commitments are not integrated. The benchmark wrapper has no production Solidity ABI or pool binding and starts from zero hidden state. The numerical `sentence` method returns zero on a missing terminal after its cap; only the benchmark entrypoint maps that to a failure status. Production integration must preserve atomic trade rollback and must not expose this partial result path.

The existing model and token/pool safety design has not been weakened or replaced. It has also not yet been connected to this WASM prototype. Stylus activation, expiry and permissionless keepalive remain deployment/liveness considerations. Exact local arithmetic and malformed-format rejection do not by themselves establish 10 swaps per second or 700,000 gas per sentence.
