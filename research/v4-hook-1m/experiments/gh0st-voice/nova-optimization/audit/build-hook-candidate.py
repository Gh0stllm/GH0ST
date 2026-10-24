from pathlib import Path
p=Path(__file__).resolve().parent
source=(p.parent.parent/'nova-pool/contracts/NovaPoolHook.sol').read_text()
def replace_fun(src,name,new):
 start=src.index('    function '+name+'(')
 op=src.index('{',start);depth=1;end=op+1
 while depth:
  if src[end]=='{':depth+=1
  if src[end]=='}':depth-=1
  end+=1
 return src[:start]+new+src[end:]
source=replace_fun(source,'hiddenState','''    function hiddenState(bytes32 id) public view returns (int16[768] memory state) {
        // Fixed 48 storage words each contain exactly sixteen signed 16-bit values.
        // Scratch writes stay below the free-memory pointer; all 768 output words are allocated.
        assembly ("memory-safe") {
            mstore(0, id)
            mstore(32, _hidden.slot)
            let base := keccak256(0, 64)
            for { let slot := 0 } lt(slot, 48) { slot := add(slot, 1) } {
                let packed := sload(add(base, slot))
                let output := add(state, shl(9, slot))
                for { let j := 0 } lt(j, 16) { j := add(j, 1) } {
                    mstore(add(output, shl(5, j)), signextend(1, shr(shl(4, j), packed)))
                }
            }
        }
    }''')
source=replace_fun(source,'_saveState','''    function _saveState(bytes32 id, int16[768] memory state) private {
        // The bounded decoder validates the neural range before this routine.
        // The 16-bit mask also preserves the scalar implementation for every int16 value.
        assembly ("memory-safe") {
            mstore(0, id)
            mstore(32, _hidden.slot)
            let base := keccak256(0, 64)
            for { let slot := 0 } lt(slot, 48) { slot := add(slot, 1) } {
                let packed := 0
                let input := add(state, shl(9, slot))
                for { let j := 0 } lt(j, 16) { j := add(j, 1) } {
                    packed := or(packed, shl(shl(4, j), and(mload(add(input, shl(5, j))), 0xffff)))
                }
                sstore(add(base, slot), packed)
            }
        }
    }''')
(p/'NovaPoolHookPacked.sol').write_text(source)
print(p/'NovaPoolHookPacked.sol')
