// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @dev TEST FIXTURE ONLY. Malicious modes deliberately violate burn accounting.
contract MockGH0ST is ERC20, ERC20Burnable {
    uint8 public mode;
    constructor() ERC20("GH0ST test fixture", "GH0ST") {
        _mint(msg.sender, 1_000_000_000 ether);
    }
    function setMode(uint8 value) external { mode = value; }
    function mintForTesting(address to, uint256 amount) external { _mint(to, amount); }
    function burnFrom(address account, uint256 value) public override {
        if (mode == 1) return;
        if (mode == 2) {
            _spendAllowance(account, msg.sender, value);
            _transfer(account, address(0xdEaD), value);
            return;
        }
        if (mode == 3) revert("mock burn rejected");
        _spendAllowance(account, msg.sender, value);
        _burn(account, value);
    }
}

interface IGenesisMint {
    function mint(uint256 tokenId, bytes32[] calldata proof) external;
}

contract RejectingReceiver is IERC721Receiver {
    function approveAndMint(address token, address nft, uint256 id, bytes32[] calldata proof) external {
        IERC20(token).approve(nft, type(uint256).max);
        IGenesisMint(nft).mint(id, proof);
    }
    function onERC721Received(address, address, uint256, bytes calldata)
        external pure returns (bytes4)
    {
        revert("receiver rejected");
    }
}

contract AcceptingReceiver is IERC721Receiver {
    function approveAndMint(address token, address nft, uint256 id, bytes32[] calldata proof) external {
        IERC20(token).approve(nft, type(uint256).max);
        IGenesisMint(nft).mint(id, proof);
    }
    function onERC721Received(address, address, uint256, bytes calldata)
        external pure returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract NonReceiver {
    function approveAndMint(address token, address nft, uint256 id, bytes32[] calldata proof) external {
        IERC20(token).approve(nft, type(uint256).max);
        IGenesisMint(nft).mint(id, proof);
    }
}

contract ReenteringReceiver is IERC721Receiver {
    IGenesisMint public genesis;
    uint256 public nextId;
    bytes32[] private _proof;
    bool public swallowFailure;
    bool public reentrySucceeded;
    bytes public reentryError;

    function configure(
        address token, address nft, uint256 id, bytes32[] calldata proof, bool swallow
    ) external {
        genesis = IGenesisMint(nft);
        nextId = id;
        _proof = proof;
        swallowFailure = swallow;
        reentrySucceeded = false;
        delete reentryError;
        IERC20(token).approve(nft, type(uint256).max);
    }
    function executeMint(uint256 id, bytes32[] calldata proof) external {
        genesis.mint(id, proof);
    }
    function onERC721Received(address, address, uint256, bytes calldata)
        external returns (bytes4)
    {
        require(msg.sender == address(genesis), "wrong NFT");
        try genesis.mint(nextId, _proof) {
            reentrySucceeded = true;
        } catch (bytes memory reason) {
            reentryError = reason;
            if (!swallowFailure) {
                assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
            }
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract TransferOnReceive is IERC721Receiver {
    address public destination;
    function approveAndMint(
        address token, address nft, uint256 id, bytes32[] calldata proof, address destination_
    ) external {
        destination = destination_;
        IERC20(token).approve(nft, type(uint256).max);
        IGenesisMint(nft).mint(id, proof);
    }
    function onERC721Received(address, address, uint256 id, bytes calldata)
        external returns (bytes4)
    {
        IERC721(msg.sender).transferFrom(address(this), destination, id);
        return IERC721Receiver.onERC721Received.selector;
    }
}
