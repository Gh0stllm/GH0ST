// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// The scanner executes contract creation only via eth_call at a pinned RH block.
// The constructor returns observations directly and no transaction is broadcast.
contract Probe {
    constructor(address target, bytes4 getter, bool mint) {
        (bool a, uint beforeBalance) = readBalance(target, getter);
        bytes memory payload = mint ? abi.encodeWithSignature("mint(address,uint256)",address(this),7)
                                    : abi.encodeWithSignature("burn(uint256)",1);
        (bool success,) = target.call{gas: 450000}(payload);
        (bool b, uint afterBalance) = readBalance(target, getter);
        bytes memory result=abi.encode(a,b,success,beforeBalance,afterBalance,address(this));
        assembly { return(add(result,32),mload(result)) }
    }
    function readBalance(address target, bytes4 getter) private view returns(bool,uint){
        (bool ok, bytes memory result)=target.staticcall{gas:80000}(abi.encodeWithSelector(getter,address(this)));
        if(!ok || result.length!=32) return(false,0);
        return(true,abi.decode(result,(uint)));
    }
}
