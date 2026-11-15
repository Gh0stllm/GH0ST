// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import "./HybridChessRules.sol";

interface IHybridChessToken {
    function decimals() external view returns(uint8);
    function balanceOf(address) external view returns(uint256);
    function transfer(address,uint256) external returns(bool);
    function transferFrom(address,address,uint256) external returns(bool);
}

/// @notice Robinhood owns the board, move legality, terminal adjudication and GH0ST escrow.
/// @dev The immutable ICP threshold signer authorizes Black moves, not winners. Its controllers
/// remain trusted to run the published engine honestly; ECDSA is not a proof of Stockfish execution.
/// Single active game intentionally matches a single isolated retained-cache engine.
contract HybridChessGame {
    using HybridChessRules for HybridChessRules.Position;
    uint256 public constant ENTRY_FEE=25_000e18;
    uint256 public constant TOTAL_PRIZE=1_000_000e18;
    uint64 public constant HUMAN_TURN_SECONDS=1 days;
    uint64 public constant BOT_TURN_SECONDS=1 hours;
    address public constant CANONICAL_GH0ST=0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559;
    uint256 public constant ROBINHOOD_CHAIN_ID=4663;
    bytes32 public constant INITIAL_TRANSCRIPT_HASH=keccak256("GH0ST_CHESS_INITIAL_V1");
    bytes32 public constant BOT_MOVE_TYPEHASH=keccak256("BotMove(bytes32 gameId,address player,uint32 ply,bytes32 positionHash,bytes32 transcriptHash,uint16 encodedMove,bytes32 engineConfigHash,uint64 validUntil)");
    bytes32 private constant DOMAIN_TYPEHASH=keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    uint256 private constant HALF_N=0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    enum Result { Active, HumanCheckmate, BotCheckmate, Draw, HumanResigned, PlayerTimeout, ServiceTimeoutRefund }
    struct Game {
        address player; uint256 nonce; uint64 openedAt; uint64 turnDeadline; uint8 result; uint32 ply;
        bytes32 positionHash; bytes32 transcriptHash; uint256 board; uint8 castling; uint8 enPassant; uint16 halfmoveClock; bool blackToMove;
    }
    struct BotMove {
        bytes32 gameId; address player; uint32 ply; bytes32 positionHash; bytes32 transcriptHash;
        uint16 encodedMove; bytes32 engineConfigHash; uint64 validUntil;
    }
    IHybridChessToken public immutable paymentToken;
    address public immutable owner;
    address public immutable attestor;
    bytes32 public immutable engineConfigHash;
    mapping(bytes32=>Game) private gameData;
    mapping(bytes32=>uint16[]) private moveHistory;
    mapping(bytes32=>mapping(bytes32=>uint8)) public repetitions;
    mapping(address=>mapping(uint256=>bool)) public nonceUsed;
    bytes32 public activeGameId;
    uint256 public totalReserved;
    bool public paused=true;
    bool private entered;
    event EntriesPaused(bool paused);
    event PoolFunded(address indexed funder,uint256 amount);
    event PoolWithdrawal(address indexed owner,uint256 amount);
    event GameEntered(bytes32 indexed gameId,address indexed player,uint256 nonce,bytes32 engineConfigHash,uint64 turnDeadline);
    event MovePlayed(bytes32 indexed gameId,uint32 indexed ply,uint16 encodedMove,bytes32 positionHash,bytes32 transcriptHash);
    event GameSettled(bytes32 indexed gameId,address indexed player,uint8 result,uint256 paid,bytes32 finalPositionHash,bytes32 transcriptHash);
    error Unauthorized(); error InvalidConfiguration(); error Reentrancy(); error Paused(); error InvalidEntry(); error Occupied();
    error InsufficientFreePool(); error Insolvent(); error TransferFailed(); error UnknownGame(); error Finished(); error WrongTurn();
    error DeadlinePassed(); error DeadlinePending(); error InvalidSignature(); error InvalidBotMove(); error DrawUnavailable();
    constructor(address token,address poolOwner,address pinnedAttestor,bytes32 configHash) {
        if(token.code.length==0||poolOwner==address(0)||poolOwner==address(this)||pinnedAttestor==address(0)||pinnedAttestor==address(this)||configHash==0) revert InvalidConfiguration();
        if(block.chainid==ROBINHOOD_CHAIN_ID && token!=CANONICAL_GH0ST) revert InvalidConfiguration();
        if(IHybridChessToken(token).decimals()!=18) revert InvalidConfiguration();
        paymentToken=IHybridChessToken(token); owner=poolOwner; attestor=pinnedAttestor; engineConfigHash=configHash;
    }
    modifier guard() { if(entered) revert Reentrancy(); entered=true; _; entered=false; }
    modifier onlyOwner() { if(msg.sender!=owner) revert Unauthorized(); _; }
    function getGame(bytes32 id) external view returns(Game memory) { return gameData[id]; }
    function getMoves(bytes32 id) external view returns(uint16[] memory) { return moveHistory[id]; }
    function activeGames() external view returns(uint256) { return activeGameId==0 ? 0:1; }
    function freePool() public view returns(uint256) { uint256 b=paymentToken.balanceOf(address(this)); return b>totalReserved ? b-totalReserved:0; }
    function isSolvent() external view returns(bool) { return paymentToken.balanceOf(address(this))>=totalReserved; }
    function setPaused(bool value) external onlyOwner guard { paused=value; emit EntriesPaused(value); }
    function fundPool(uint256 amount) external guard { if(amount==0) revert InvalidEntry(); _transferExact(msg.sender,address(this),amount); emit PoolFunded(msg.sender,amount); }
    function withdrawPool(uint256 amount) external onlyOwner guard {
        _solvent(); if(amount==0||amount>freePool()) revert InsufficientFreePool();
        _transferExact(address(this),owner,amount); emit PoolWithdrawal(owner,amount);
    }
    function gameIdFor(address player,uint256 nonce) public view returns(bytes32) { return keccak256(abi.encode(block.chainid,address(this),player,nonce)); }
    function enterGame(uint256 nonce) external guard returns(bytes32 id) {
        if(paused) revert Paused(); if(activeGameId!=0) revert Occupied();
        if(nonceUsed[msg.sender][nonce]||msg.sender==address(this)) revert InvalidEntry();
        _solvent(); if(freePool()<TOTAL_PRIZE) revert InsufficientFreePool();
        id=gameIdFor(msg.sender,nonce); nonceUsed[msg.sender][nonce]=true;
        HybridChessRules.Position memory p=HybridChessRules.initial();
        Game storage g=gameData[id]; g.player=msg.sender; g.nonce=nonce; g.openedAt=uint64(block.timestamp);
        g.turnDeadline=uint64(block.timestamp)+HUMAN_TURN_SECONDS; g.transcriptHash=INITIAL_TRANSCRIPT_HASH;
        _store(g,p); repetitions[id][p.key()]=1; activeGameId=id; totalReserved=TOTAL_PRIZE;
        _transferExact(msg.sender,address(this),ENTRY_FEE);
        emit GameEntered(id,msg.sender,nonce,engineConfigHash,g.turnDeadline);
    }
    function playHumanMove(bytes32 id,uint16 move_) external guard {
        Game storage g=_active(id); if(msg.sender!=g.player) revert Unauthorized(); if(g.blackToMove) revert WrongTurn();
        if(block.timestamp>g.turnDeadline) revert DeadlinePassed(); _play(id,g,move_);
    }
    function domainSeparator() public view returns(bytes32) { return keccak256(abi.encode(DOMAIN_TYPEHASH,keccak256("GH0ST Hybrid Chess"),keccak256("1"),block.chainid,address(this))); }
    function botMoveDigest(BotMove calldata m) public view returns(bytes32) {
        return keccak256(abi.encodePacked(hex"1901",domainSeparator(),keccak256(abi.encode(BOT_MOVE_TYPEHASH,m.gameId,m.player,m.ply,m.positionHash,m.transcriptHash,m.encodedMove,m.engineConfigHash,m.validUntil))));
    }
    function playBotMove(BotMove calldata m,bytes calldata signature) external guard {
        Game storage g=_active(m.gameId); if(!g.blackToMove) revert WrongTurn();
        if(m.player!=g.player||m.ply!=g.ply||m.positionHash!=g.positionHash||m.transcriptHash!=g.transcriptHash||m.engineConfigHash!=engineConfigHash||m.validUntil>g.turnDeadline) revert InvalidBotMove();
        if(block.timestamp>g.turnDeadline||block.timestamp>m.validUntil) revert DeadlinePassed();
        _verify(botMoveDigest(m),signature); _play(m.gameId,g,m.encodedMove);
    }
    /// @notice Human may claim the current position's threefold/50-move draw. Black claims automatically.
    function claimDraw(bytes32 id) external guard {
        Game storage g=_active(id); if(msg.sender!=g.player) revert Unauthorized(); if(g.blackToMove) revert WrongTurn();
        if(block.timestamp>g.turnDeadline) revert DeadlinePassed();
        if(g.halfmoveClock<100&&repetitions[id][_position(g).key()]<3) revert DrawUnavailable();
        _settle(id,g,Result.Draw,0);
    }
    function resign(bytes32 id) external guard { Game storage g=_active(id); if(msg.sender!=g.player) revert Unauthorized(); _settle(id,g,Result.HumanResigned,0); }
    /// @notice Anyone can close a missed turn. Bot outage refunds entry; player abandonment forfeits entry.
    function claimTimeout(bytes32 id) external guard {
        Game storage g=_active(id); if(block.timestamp<=g.turnDeadline) revert DeadlinePending();
        if(g.blackToMove) _settle(id,g,Result.ServiceTimeoutRefund,ENTRY_FEE); else _settle(id,g,Result.PlayerTimeout,0);
    }
    function _position(Game storage g) private view returns(HybridChessRules.Position memory) { return HybridChessRules.Position(g.board,g.castling,g.enPassant,g.halfmoveClock,g.blackToMove); }
    function _store(Game storage g,HybridChessRules.Position memory p) private {
        g.board=p.board; g.castling=p.castling; g.enPassant=p.enPassant; g.halfmoveClock=p.halfmoveClock; g.blackToMove=p.blackToMove;
        g.positionHash=keccak256(abi.encode(p.board,p.castling,p.enPassant,p.blackToMove));
    }
    function _play(bytes32 id,Game storage g,uint16 move_) private {
        HybridChessRules.Position memory n=_position(g).applyMove(move_);
        _store(g,n); g.ply++; moveHistory[id].push(move_); g.transcriptHash=keccak256(abi.encode(g.transcriptHash,move_));
        uint8 count=++repetitions[id][n.key()];
        g.turnDeadline=uint64(block.timestamp)+(n.blackToMove ? BOT_TURN_SECONDS:HUMAN_TURN_SECONDS);
        emit MovePlayed(id,g.ply,move_,g.positionHash,g.transcriptHash);
        if(!n.hasLegalMove()) {
            if(n.inCheck(n.blackToMove)) _settle(id,g,n.blackToMove ? Result.HumanCheckmate:Result.BotCheckmate,n.blackToMove ? TOTAL_PRIZE:0);
            else _settle(id,g,Result.Draw,0);
        } else if(n.insufficient()||count>=5||n.halfmoveClock>=150||(n.blackToMove&&(count>=3||n.halfmoveClock>=100))) _settle(id,g,Result.Draw,0);
    }
    function _active(bytes32 id) private view returns(Game storage g) {
        g=gameData[id]; if(g.player==address(0)) revert UnknownGame(); if(g.result!=0||id!=activeGameId) revert Finished();
    }
    function _settle(bytes32 id,Game storage g,Result result,uint256 paid) private {
        _solvent(); g.result=uint8(result); totalReserved=0; activeGameId=0;
        // A successful attack ends this round. Review the line and explicitly reopen;
        // a public deterministic winning transcript must not drain repeated prizes.
        if(result==Result.HumanCheckmate) { paused=true; emit EntriesPaused(true); }
        if(paid!=0) _transferExact(address(this),g.player,paid);
        emit GameSettled(id,g.player,uint8(result),paid,g.positionHash,g.transcriptHash);
    }
    function _solvent() private view { if(paymentToken.balanceOf(address(this))<totalReserved) revert Insolvent(); }
    function _transferExact(address from,address to,uint256 amount) private {
        uint256 beforeFrom=paymentToken.balanceOf(from); uint256 beforeTo=paymentToken.balanceOf(to);
        bool ok=from==address(this) ? paymentToken.transfer(to,amount):paymentToken.transferFrom(from,to,amount);
        if(!ok||paymentToken.balanceOf(from)+amount!=beforeFrom||paymentToken.balanceOf(to)!=beforeTo+amount) revert TransferFailed();
    }
    function _verify(bytes32 digest,bytes calldata signature) private view {
        if(signature.length!=65) revert InvalidSignature(); bytes32 r; bytes32 s; uint8 v;
        assembly { r:=calldataload(signature.offset) s:=calldataload(add(signature.offset,32)) v:=byte(0,calldataload(add(signature.offset,64))) }
        if(v<27) v+=27;
        if((v!=27&&v!=28)||uint256(s)==0||uint256(s)>HALF_N||ecrecover(digest,v,r,s)!=attestor) revert InvalidSignature();
    }
}
