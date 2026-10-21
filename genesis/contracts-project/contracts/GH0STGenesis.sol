// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IGH0STBurnable is IERC20Metadata {
    function burnFrom(address account, uint256 value) external;
}

/// @notice Immutable NFT associations to GH0ST's 495 Genesis model-weight shards.
/// @dev Self-mint only; three lifetime mints per address. No owner, treasury,
/// free mint, price setter, metadata setter, external NFT burn, or upgrade path.
/// Model copyright and inference access are independent of NFT ownership.
contract GH0STGenesis is ERC721, IERC2981, ReentrancyGuard {
    uint256 public constant MAX_SUPPLY = 495;
    uint256 public constant MAX_PER_WALLET = 3;
    uint256 public constant BURN_AMOUNT = 200_000 ether; // GH0ST has 18 decimals.
    uint256 public constant ROYALTY_BPS = 350;
    uint256 public constant SHARD_PAYLOAD_BYTES = 98_303;
    uint256 public constant MODEL_BYTES = 48_626_528;
    bytes32 public constant MODEL_SHA256 =
        0x9cc5e90880d96ff15bf4110f7970a7ea473c9b86576298691ade1e745672e7a9;
    string public constant METADATA_BASE_URI =
        "ipfs://bafybeiacuudlonut2coevovyc5t5u3hc6bjjf4ekfrzd4d5544mh4o7z2i/";
    string private constant COLLECTION_URI =
        "ipfs://bafkreigrokhivgmp763x3xbwhug5jfvk7i5b2hwlavtzb6rpld3mkwzpsq";

    IGH0STBurnable public immutable gh0stToken;
    address public immutable weightIndex;
    bytes32 public immutable tokenCodeHash;
    bytes32 public immutable indexCodeHash;
    bytes32 public immutable shardMerkleRoot;
    address public immutable royaltyRecipient;
    uint256 public totalMinted;
    mapping(address wallet => uint256 count) public mintedBy;

    error InvalidTokenId();
    error AlreadyMinted();
    error WalletMintLimit();
    error InvalidToken();
    error InvalidIndex();
    error InvalidShard();
    error InvalidProof();
    error BurnInvariantFailed();
    error InvalidRoyaltyRecipient();

    event GenesisMinted(
        address indexed wallet,
        uint256 indexed tokenId,
        uint256 tokensBurned,
        address shard,
        bytes32 shardCodeHash
    );

    constructor(
        address token_,
        address weightIndex_,
        bytes32 tokenCodeHash_,
        bytes32 indexCodeHash_,
        bytes32 shardMerkleRoot_,
        address royaltyRecipient_
    ) ERC721("GH0ST Genesis", "GH0STGEN") {
        if (royaltyRecipient_ == address(0) || royaltyRecipient_ == address(this)) {
            revert InvalidRoyaltyRecipient();
        }
        if (
            token_.code.length == 0 || tokenCodeHash_ == bytes32(0) ||
            token_.codehash != tokenCodeHash_ || IERC20Metadata(token_).decimals() != 18
        ) revert InvalidToken();
        if (
            weightIndex_.code.length != 49 + 20 * MAX_SUPPLY ||
            indexCodeHash_ == bytes32(0) || weightIndex_.codehash != indexCodeHash_
        ) revert InvalidIndex();
        if (shardMerkleRoot_ == bytes32(0)) revert InvalidProof();
        bytes memory header = new bytes(48);
        assembly ("memory-safe") {
            extcodecopy(weightIndex_, add(header, 32), 1, 48)
        }
        bytes4 magic;
        uint256 payload;
        uint256 fileBytes;
        bytes32 fileHash;
        assembly ("memory-safe") {
            let p := add(header, 32)
            magic := mload(p)
            payload := shr(224, mload(add(p, 4)))
            fileBytes := shr(192, mload(add(p, 8)))
            fileHash := mload(add(p, 16))
        }
        if (
            magic != 0x47344958 || payload != SHARD_PAYLOAD_BYTES ||
            fileBytes != MODEL_BYTES || fileHash != MODEL_SHA256
        ) revert InvalidIndex();
        gh0stToken = IGH0STBurnable(token_);
        weightIndex = weightIndex_;
        tokenCodeHash = tokenCodeHash_;
        indexCodeHash = indexCodeHash_;
        shardMerkleRoot = shardMerkleRoot_;
        royaltyRecipient = royaltyRecipient_;
    }

    /// @notice Burn 200,000 GH0ST from the caller and mint one chosen piece to them.
    /// @dev Transfers do not reduce mintedBy. Contract wallets must accept ERC-721.
    /// @param shardProof Nine sorted-pair Merkle siblings proving the pinned shard.
    function mint(uint256 tokenId, bytes32[] calldata shardProof) external nonReentrant {
        _checkTokenId(tokenId);
        if (_ownerOf(tokenId) != address(0)) revert AlreadyMinted();
        if (mintedBy[msg.sender] >= MAX_PER_WALLET) revert WalletMintLimit();
        if (address(gh0stToken).codehash != tokenCodeHash) revert InvalidToken();
        (address shard, bytes32 shardCodeHash, uint256 offset, uint256 length) = shardInfo(tokenId);
        if (
            shardProof.length != 9 ||
            !MerkleProof.verifyCalldata(
                shardProof,
                shardMerkleRoot,
                _leaf(tokenId, shard, shardCodeHash, offset, length)
            )
        ) revert InvalidProof();

        uint256 supplyBefore = gh0stToken.totalSupply();
        uint256 balanceBefore = gh0stToken.balanceOf(msg.sender);
        if (supplyBefore < BURN_AMOUNT || balanceBefore < BURN_AMOUNT) revert BurnInvariantFailed();
        ++totalMinted;
        ++mintedBy[msg.sender];
        gh0stToken.burnFrom(msg.sender, BURN_AMOUNT);
        if (
            gh0stToken.totalSupply() != supplyBefore - BURN_AMOUNT ||
            gh0stToken.balanceOf(msg.sender) != balanceBefore - BURN_AMOUNT
        ) revert BurnInvariantFailed();
        _safeMint(msg.sender, tokenId);
        emit GenesisMinted(msg.sender, tokenId, BURN_AMOUNT, shard, shardCodeHash);
    }

    /// @notice Logical export range and current runtime hash of the pinned shard.
    /// @dev A mint also proves these facts against the immutable manifest Merkle root.
    /// Logical ranges exclude the leading STOP byte in each data contract.
    function shardInfo(uint256 tokenId)
        public view returns (address shard, bytes32 runtimeCodeHash, uint256 offset, uint256 length)
    {
        _checkTokenId(tokenId);
        address index = weightIndex;
        if (index.codehash != indexCodeHash) revert InvalidIndex();
        uint256 shardIndex = tokenId - 1;
        assembly ("memory-safe") {
            let p := mload(0x40)
            extcodecopy(index, p, add(49, mul(shardIndex, 20)), 20)
            shard := shr(96, mload(p))
        }
        offset = shardIndex * SHARD_PAYLOAD_BYTES;
        length = MODEL_BYTES - offset;
        if (length > SHARD_PAYLOAD_BYTES) length = SHARD_PAYLOAD_BYTES;
        if (shard.code.length != length + 1) revert InvalidShard();
        runtimeCodeHash = shard.codehash;
    }

    function shardLeaf(uint256 tokenId) public view returns (bytes32) {
        (address shard, bytes32 hash, uint256 offset, uint256 length) = shardInfo(tokenId);
        return _leaf(tokenId, shard, hash, offset, length);
    }

    /// @notice Burn total attributable to successful Genesis mints only.
    function totalBurned() external view returns (uint256) {
        return totalMinted * BURN_AMOUNT;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        bytes memory padded = new bytes(3);
        padded[0] = bytes1(uint8(48 + tokenId / 100));
        padded[1] = bytes1(uint8(48 + (tokenId / 10) % 10));
        padded[2] = bytes1(uint8(48 + tokenId % 10));
        return string.concat(METADATA_BASE_URI, string(padded), ".json");
    }

    function contractURI() external pure returns (string memory) {
        return COLLECTION_URI;
    }

    /// @notice Fixed 3.5% secondary-sale royalty, in the sale price's currency.
    /// @dev ERC-2981 signals a royalty; settlement depends on marketplace support.
    /// Transfers and primary burn-to-mint do not collect a royalty.
    function royaltyInfo(uint256, uint256 salePrice)
        external view override returns (address receiver, uint256 royaltyAmount)
    {
        return (royaltyRecipient, Math.mulDiv(salePrice, ROYALTY_BPS, 10_000));
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, IERC165) returns (bool)
    {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }

    function _checkTokenId(uint256 tokenId) private pure {
        if (tokenId == 0 || tokenId > MAX_SUPPLY) revert InvalidTokenId();
    }

    function _leaf(uint256 tokenId, address shard, bytes32 hash, uint256 offset, uint256 length)
        private pure returns (bytes32)
    {
        return keccak256(bytes.concat(keccak256(abi.encode(tokenId, shard, hash, offset, length))));
    }
}
