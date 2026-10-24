from pathlib import Path
import hashlib,json
D=Path(__file__).resolve().parent
ROOT=D.parent.parent
src=(ROOT/'nova-pool/contracts/NovaPoolHook.sol').read_text()
def replace_fn(s,name,new):
    a=s.index('    function '+name+'('); b=s.index('{',a); depth=1;i=b+1
    while depth:
        depth += (s[i]=='{')-(s[i]=='}');i+=1
    return s[:a]+new+s[i:]
def make(bits,lanes,slots):
    load=[];save=[]
    for j in range(lanes):
        unpack=f'signextend(1, shr({j*bits}, packed))' if bits==16 else f'sar(244, shl(244, shr({j*bits}, packed)))'
        load.append(f'                mstore(add(output, {j*32}), {unpack})')
        save.append(f'                packed := or(packed, shl({j*bits}, and(mload(add(input, {j*32})), {(1<<bits)-1})))')
    # 768 divisible16 but 768=36*21+12. Last partialslot cannotaccessoutsideallocatedarray.
    fullslots=768//lanes;tail=768%lanes
    partload='';partsave=''
    if tail:
        partload='\n            let packed := sload(add(base, '+str(fullslots)+'))\n            let output := add(state, '+str(fullslots*lanes*32)+')\n'+'\n'.join(load[:tail])
        partsave='\n            let packed := 0\n            let input := add(state, '+str(fullslots*lanes*32)+')\n'+'\n'.join(save[:tail])+f'\n            sstore(add(base, {fullslots}), packed)'
    read=f'''    function hiddenState(bytes32 id) public view returns (int16[768] memory state) {{
        // Each saved value has passed the unchanged neural range decoder [-1024,1024].
        // Fixed-size allocated output; partial final word writes exactly its remaining cells.
        assembly ("memory-safe") {{
            mstore(0, id)
            mstore(32, _hidden.slot)
            let base := keccak256(0, 64)
            for {{ let slot := 0 }} lt(slot, {fullslots}) {{ slot := add(slot, 1) }} {{
                let packed := sload(add(base, slot))
                let output := add(state, mul({lanes*32}, slot))
{chr(10).join(load)}
            }}{partload}
        }}
    }}'''
    write=f'''    function _saveState(bytes32 id, int16[768] memory state) private {{
        // Called only after decodeStep validates all 768 cells. Exact two's-complement {bits}-bit storage.
        // Scratch is 0..63; free-memory pointer and zero slot remain intact.
        assembly ("memory-safe") {{
            mstore(0, id)
            mstore(32, _hidden.slot)
            let base := keccak256(0, 64)
            for {{ let slot := 0 }} lt(slot, {fullslots}) {{ slot := add(slot, 1) }} {{
                let packed := 0
                let input := add(state, mul({lanes*32}, slot))
{chr(10).join(save)}
                sstore(add(base, slot), packed)
            }}{partsave}
        }}
    }}'''
    result=replace_fn(replace_fn(src,'hiddenState',read),'_saveState',write)
    if slots!=48:result=result.replace('mapping(bytes32 => bytes32[48]) private _hidden;','mapping(bytes32 => bytes32[37]) private _hidden;')
    return result
for bits,lanes,slots in [(16,16,48),(12,21,37)]:
    dest=D/f'NovaPoolHook{bits}.sol';dest.write_text(make(bits,lanes,slots))
print(json.dumps({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in D.glob('NovaPoolHook*.sol')},indent=2))
