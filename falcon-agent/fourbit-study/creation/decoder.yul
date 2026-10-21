// SPDX-License-Identifier: MIT
// Creation-only lossless Huffman decoder. Returns STOP + the original shard.
// Input is pinned, locally executed creation bytecode; returned runtime hash is checked.
// No deployed decoder, external call, storage access, or additional contract.
object "GH0STCreate" {
  code {
    codecopy(0, sub(codesize(), 4), 4)
    let packedSize := shr(224, mload(0))
    codecopy(0, sub(sub(codesize(), 4), packedSize), packedSize)
    let expected := mload(0)
    let size := shr(232, mload(32))
    let blocks := shr(240, mload(35))
    let ip := 37
    let table := 0x18000
    let output := 0x1c000
    let dst := add(output, 1)
    for { let block := 0 } lt(block, blocks) { block := add(block, 1) } {
      let kind := byte(0, mload(ip))
      let length := and(shr(224, mload(ip)), 0xffffff)
      ip := add(ip, 4)
      switch kind
      case 0 {
        mcopy(dst, ip, length)
        ip := add(ip, length)
        dst := add(dst, length)
      }
      default {
        let width := byte(0, mload(ip))
        ip := add(ip, 1)
        let counts := ip
        ip := add(ip, width)
        let cursor := table
        for { let n := 1 } iszero(gt(n, width)) { n := add(n, 1) } {
          let count := byte(0, mload(add(counts, sub(n, 1))))
          for { let k := 0 } lt(k, count) { k := add(k, 1) } {
            let symbol := byte(0, mload(ip))
            ip := add(ip, 1)
            let finish := add(cursor, shl(add(sub(width, n), 1), 1))
            let word := mul(or(shl(4, symbol), n), 0x0001000100010001000100010001000100010001000100010001000100010001)
            for { } lt(cursor, finish) { cursor := add(cursor, 32) } { mstore(cursor, word) }
            cursor := finish
          }
        }
        let end := add(dst, length)
        let pos := 0
        let shift := sub(256, width)
        // Four outputs per loop amortize control-flow gas. The final loop handles tails.
        for { } iszero(gt(add(dst, 4), end)) { } {
          let buffer := shl(and(pos, 7), mload(add(ip, shr(3, pos))))
          let a := shr(240, mload(add(table, shl(1, shr(shift, buffer)))))
          mstore8(dst, shr(4, a))
          pos := add(pos, and(a, 15))
          buffer := shl(and(a, 15), buffer)
          let b := shr(240, mload(add(table, shl(1, shr(shift, buffer)))))
          mstore8(add(dst, 1), shr(4, b))
          pos := add(pos, and(b, 15))
          buffer := shl(and(b, 15), buffer)
          let c := shr(240, mload(add(table, shl(1, shr(shift, buffer)))))
          mstore8(add(dst, 2), shr(4, c))
          pos := add(pos, and(c, 15))
          buffer := shl(and(c, 15), buffer)
          let d := shr(240, mload(add(table, shl(1, shr(shift, buffer)))))
          mstore8(add(dst, 3), shr(4, d))
          pos := add(pos, and(d, 15))
          dst := add(dst, 4)
        }
        for { } lt(dst, end) { dst := add(dst, 1) } {
          let e := shr(240, mload(add(table, shl(1, shr(shift, shl(and(pos, 7), mload(add(ip, shr(3, pos)))))))))
          mstore8(dst, shr(4, e))
          pos := add(pos, and(e, 15))
        }
        ip := add(ip, shr(3, add(pos, 7)))
      }
    }
    if iszero(eq(keccak256(output, size), expected)) { revert(0, 0) }
    return(output, size)
  }
}
