// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice A participation credential, not proof of personhood or AI execution.
contract GH0STPassport is ERC721 {
    using Strings for uint256;
    IERC721 public immutable agentRegistry;
    uint256 public totalSupply;
    mapping(address => uint256) public passportOf;
    mapping(uint256 => uint256) public agentIdOf;
    mapping(uint256 => bool) public agentUsed;
    event Locked(uint256 tokenId);
    event PassportMinted(uint256 indexed passportId, address indexed holder, uint256 indexed agentId);
    error Soulbound();
    error Ineligible();

    constructor(address registry) ERC721("GH0ST Passport", "GHOSTPASS") {
        if (registry.code.length == 0 || !IERC721(registry).supportsInterface(0x80ac58cd)) revert Ineligible();
        agentRegistry = IERC721(registry);
    }

    function mint(uint256 agentId) external returns (uint256 passportId) {
        if (passportOf[msg.sender] != 0 || agentUsed[agentId] || agentRegistry.ownerOf(agentId) != msg.sender) revert Ineligible();
        passportId = ++totalSupply;
        passportOf[msg.sender] = passportId;
        agentIdOf[passportId] = agentId;
        agentUsed[agentId] = true;
        _safeMint(msg.sender, passportId);
        emit Locked(passportId);
        emit PassportMinted(passportId, msg.sender, agentId);
    }

    /// @dev Transferring the upstream identity deactivates the old passport.
    function isActive(address holder) external view returns (bool) {
        uint256 passportId = passportOf[holder];
        if (passportId == 0) return false;
        try agentRegistry.ownerOf(agentIdOf[passportId]) returns (address current) { return current == holder; }
        catch { return false; }
    }
    function locked(uint256 tokenId) external view returns (bool) { _requireOwned(tokenId); return true; }
    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == 0xb45a3c0e || super.supportsInterface(interfaceId);
    }
    function approve(address, uint256) public pure override { revert Soulbound(); }
    function setApprovalForAll(address, bool) public pure override { revert Soulbound(); }
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0) || to == address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory number = tokenId.toString();
        string memory svg = string.concat('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#080a0a"/><rect x="20" y="20" width="600" height="360" rx="16" fill="none" stroke="#9ae5ca"/><g fill="#e8f5ef" font-family="monospace"><text x="48" y="72" font-size="22">GH0ST / PASSPORT</text><text x="225" y="218" font-size="74">[0_0]</text><text x="48" y="320" font-size="20">#', number, '</text><text x="48" y="350" font-size="14">BNB ACCESS / ROOTED ON ROBINHOOD</text></g></svg>');
        return string.concat("data:application/json;base64,", Base64.encode(bytes(string.concat('{"name":"GH0ST Passport #', number, '","description":"Non-transferable access credential for the GH0ST BNB layer. GH0ST remains rooted on Robinhood. Not proof of a unique person or model execution.","image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '","attributes":[{"trait_type":"Agent ID","value":"', agentIdOf[tokenId].toString(), '"}]}'))));
    }
}
