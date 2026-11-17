// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// These contracts generate labelled automated demonstrations, not organic usage.
// The test token and NFT have no backing, redemption right, or promised value.
contract GL3AutomatedDemoPulse {
    address public immutable operator;
    uint256 public pulses;
    event AutomatedDemoPulse(uint256 indexed sequence);
    constructor(address operator_) { require(operator_ != address(0)); operator = operator_; }
    function pulse() external {
        require(msg.sender == operator, "demo operator only");
        emit AutomatedDemoPulse(++pulses);
    }
}

contract GL3AutomatedDemoToken {
    string public constant name = "GL3 Automated Demo Token - NO VALUE";
    string public constant symbol = "GL3DEMO";
    uint8 public constant decimals = 18;
    uint256 public constant totalSupply = 1_000_000 ether;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    constructor(address operator) {
        require(operator != address(0)); balanceOf[operator] = totalSupply;
        emit Transfer(address(0), operator, totalSupply);
    }
    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value); return true;
    }
    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value); return true;
    }
    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 permitted = allowance[from][msg.sender];
        if (permitted != type(uint256).max) allowance[from][msg.sender] = permitted - value;
        _transfer(from, to, value); return true;
    }
    function _transfer(address from, address to, uint256 value) private {
        require(to != address(0), "zero recipient");
        balanceOf[from] -= value; balanceOf[to] += value; emit Transfer(from, to, value);
    }
}

interface DemoERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4);
}

contract GL3AutomatedDemoNFT {
    string public constant name = "GL3 Automated Demo NFT - NO VALUE";
    string public constant symbol = "GL3DEMONFT";
    address public immutable operator;
    uint256 public minted;
    uint256 public constant maxSupply = 100_000;
    mapping(uint256 => address) private owners;
    mapping(address => uint256) private balances;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    constructor(address operator_) { require(operator_ != address(0)); operator = operator_; }
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x80ac58cd || id == 0x5b5e139f;
    }
    function ownerOf(uint256 id) public view returns (address) {
        address owner = owners[id]; require(owner != address(0), "nonexistent demo"); return owner;
    }
    function balanceOf(address owner) external view returns (uint256) {
        require(owner != address(0)); return balances[owner];
    }
    function tokenURI(uint256 id) external view returns (string memory) {
        ownerOf(id);
        return 'data:application/json,{"name":"GL3 Automated Demo NFT","description":"Automated chain demonstration. No backing or promised value."}';
    }
    function mintDemo() external returns (uint256 id) {
        require(msg.sender == operator, "demo operator only");
        id = ++minted; require(id <= maxSupply, "demo collection complete");
        owners[id] = operator; balances[operator]++; emit Transfer(address(0), operator, id);
    }
    function approve(address approved, uint256 id) external {
        address owner = ownerOf(id);
        require(msg.sender == owner || isApprovedForAll[owner][msg.sender]);
        require(approved != owner); getApproved[id] = approved; emit Approval(owner, approved, id);
    }
    function setApprovalForAll(address approved, bool enabled) external {
        require(approved != msg.sender); isApprovedForAll[msg.sender][approved] = enabled;
        emit ApprovalForAll(msg.sender, approved, enabled);
    }
    function transferFrom(address from, address to, uint256 id) public {
        require(ownerOf(id) == from && to != address(0));
        require(msg.sender == from || msg.sender == getApproved[id] || isApprovedForAll[from][msg.sender]);
        delete getApproved[id]; owners[id] = to; balances[from]--; balances[to]++;
        emit Transfer(from, to, id);
    }
    function safeTransferFrom(address from, address to, uint256 id) external {
        safeTransferFrom(from, to, id, "");
    }
    function safeTransferFrom(address from, address to, uint256 id, bytes memory data) public {
        transferFrom(from, to, id);
        if (to.code.length != 0)
            require(DemoERC721Receiver(to).onERC721Received(msg.sender, from, id, data) == 0x150b7a02);
    }
}
