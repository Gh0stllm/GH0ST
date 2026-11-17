// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

// Synthetic token and bootstrap fixtures ONLY. No proof/root publisher exists.
interface IUnitBridge {
    function setDelayedInbox(address,bool) external;
    function setOutbox(address,bool) external;
    function setSequencerInbox(address) external;
}

contract UnitBootstrapAuthority {
    address public immutable bootstrapper = msg.sender;
    bool public bootstrapSealed;
    function owner() external view returns(address) { return bootstrapSealed ? address(0) : bootstrapper; }
    function seal() external { require(msg.sender==bootstrapper && !bootstrapSealed,"bootstrap"); bootstrapSealed=true; }
}

contract UnitNativeToken {
    string public constant name="GL3 synthetic native token";
    string public constant symbol="UNIT";
    uint8 public constant decimals=18;
    uint256 public totalSupply;
    address public immutable controller=msg.sender;
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    // All faults are synthetic, restricted to a chosen transfer source.
    enum Fault { Exact, Tax, NoTransfer, ReturnFalse, ExtraDebit }
    Fault public fault;
    address public faultFrom;
    event Transfer(address indexed from,address indexed to,uint256 value);
    event Approval(address indexed owner,address indexed spender,uint256 value);
    constructor(uint256 supply) {totalSupply=supply;balanceOf[msg.sender]=supply;emit Transfer(address(0),msg.sender,supply);}
    function setFault(Fault value,address from) external {require(msg.sender==controller,"controller");fault=value;faultFrom=from;}
    function approve(address spender,uint256 value) external returns(bool){allowance[msg.sender][spender]=value;emit Approval(msg.sender,spender,value);return true;}
    function transfer(address to,uint256 value) external returns(bool){return _transfer(msg.sender,to,value);}
    function transferFrom(address from,address to,uint256 value) external returns(bool){uint256 a=allowance[from][msg.sender];require(a>=value,"allowance");if(a!=type(uint256).max)allowance[from][msg.sender]=a-value;return _transfer(from,to,value);}
    function _transfer(address from,address to,uint256 value) private returns(bool){
        require(to!=address(0),"zero");Fault f=from==faultFrom?fault:Fault.Exact;
        if(f==Fault.ReturnFalse)return false;
        if(f==Fault.NoTransfer)return true;
        uint256 debit=value+(f==Fault.ExtraDebit?1:0),credit=value-(f==Fault.Tax&&value>0?1:0);
        require(balanceOf[from]>=debit,"balance");balanceOf[from]-=debit;balanceOf[to]+=credit;
        totalSupply-=debit-credit;emit Transfer(from,to,credit);return true;
    }
}

contract UnitCloneFactory {
    event Clone(address indexed instance,address indexed implementation);
    function createAndInitialize(address implementation,bytes calldata initialization) external returns(address instance){
        // Exact immutable EIP-1167 runtime; no admin slot or upgrade entry point.
        bytes memory code=abi.encodePacked(hex"3d602d80600a3d3981f3",hex"363d3d373d3d3d363d73",implementation,hex"5af43d82803e903d91602b57fd5bf3");
        assembly {instance:=create(0,add(code,32),mload(code))}
        require(instance!=address(0),"clone");
        (bool success,bytes memory result)=instance.call(initialization);
        if(!success){assembly {revert(add(result,32),mload(result))}}
        emit Clone(instance,implementation);
    }
}

contract UnitReader4844 {
    function getBlobBaseFee() external pure returns(uint256){return 1;}
    function getDataHashes() external pure returns(bytes32[] memory){return new bytes32[](0);}
}

// Direct escrow transfer unit fixture, NOT a canonical Outbox and NOT a proof
// finalizer. It has no send-root setter. Use only in a separate synthetic unit
// profile when testing internal transfer-delta failures, never for an E2E claim.
contract UnitEscrowCallOnly {
    function execute(address bridge,address to,uint256 value,bytes calldata data) external returns(bool,bytes memory){
        (bool callOK,bytes memory result)=bridge.call(abi.encodeWithSignature("executeCall(address,uint256,bytes)",to,value,data));
        if(!callOK){assembly {revert(add(result,32),mload(result))}}
        (bool success,bytes memory returnData)=abi.decode(result,(bool,bytes));
        require(success,"escrow target failed");return(success,returnData);
    }
}
