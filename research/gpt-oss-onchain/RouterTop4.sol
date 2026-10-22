// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Exact integer top-4 selection for 32 synthetic expert scores.
/// @dev Ties choose the lower expert index. No router matrix or softmax is implemented.
contract RouterTop4 {
    function sortedControl(int256[32] calldata scores) external pure returns(uint256[4] memory result) {
        uint256[32] memory order;
        for(uint256 i; i<32; ++i) order[i]=i;
        for(uint256 i=1; i<32; ++i) {
            uint256 id=order[i]; uint256 j=i;
            while(j>0 && scores[order[j-1]] < scores[id]) {
                order[j]=order[j-1]; --j;
            }
            order[j]=id;
        }
        for(uint256 i; i<4; ++i) result[i]=order[i];
    }

    function selected(int256[32] calldata scores) external pure returns(uint256[4] memory result) {
        assembly ("memory-safe") {
            let v0:=0x8000000000000000000000000000000000000000000000000000000000000000
            let v1:=v0 let v2:=v0 let v3:=v0
            let i0:=255 let i1:=255 let i2:=255 let i3:=255
            for {let i:=0} lt(i,32) {i:=add(i,1)} {
                let v:=calldataload(add(scores,mul(i,32)))
                switch or(sgt(v,v0),and(eq(v,v0),lt(i,i0)))
                case 1 {v3:=v2 i3:=i2 v2:=v1 i2:=i1 v1:=v0 i1:=i0 v0:=v i0:=i}
                default {
                    switch or(sgt(v,v1),and(eq(v,v1),lt(i,i1)))
                    case 1 {v3:=v2 i3:=i2 v2:=v1 i2:=i1 v1:=v i1:=i}
                    default {
                        switch or(sgt(v,v2),and(eq(v,v2),lt(i,i2)))
                        case 1 {v3:=v2 i3:=i2 v2:=v i2:=i}
                        default {
                            if or(sgt(v,v3),and(eq(v,v3),lt(i,i3))) {v3:=v i3:=i}
                        }
                    }
                }
            }
            mstore(result,i0) mstore(add(result,32),i1)
            mstore(add(result,64),i2) mstore(add(result,96),i3)
        }
    }
}
