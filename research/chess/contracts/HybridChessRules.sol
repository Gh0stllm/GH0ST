// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Native chess rules. a1=0, h8=63; nibble pieces p1 n2 b3 r4 q5 k6, Black+8.
/// @dev Orthodox chess only. Exact en-passant legality, all four promotions and castling.
library HybridChessRules {
    struct Position { uint256 board; uint8 castling; uint8 enPassant; uint16 halfmoveClock; bool blackToMove; }
    error IllegalMove();
    function initial() internal pure returns (Position memory p) {
        p.board = 0xcabedbac99999999000000000000000000000000000000001111111142365324;
        p.castling=15; p.enPassant=64;
    }
    function piece(uint256 b, uint8 sq) internal pure returns (uint8) { return uint8((b >> (uint256(sq)*4)) & 15); }
    function put(uint256 b,uint8 sq,uint8 v) internal pure returns(uint256) { uint256 shift=uint256(sq)*4; return (b & ~(uint256(15)<<shift)) | (uint256(v)<<shift); }
    function black(uint8 v) internal pure returns(bool) { return v>=8; }
    function abs(int256 n) private pure returns(uint256) { return uint256(n<0 ? -n:n); }
    function attacked(uint256 b,uint8 target,bool byBlack) internal pure returns(bool) {
        int256 tx=int256(uint256(target%8)); int256 ty=int256(uint256(target/8));
        for(uint8 s=0;s<64;s++) {
            uint8 v=piece(b,s); if(v==0 || black(v)!=byBlack) continue;
            uint8 kind=v&7; int256 dx=tx-int256(uint256(s%8)); int256 dy=ty-int256(uint256(s/8));
            if(kind==1) { if(abs(dx)==1 && dy==(byBlack ? int256(-1):int256(1))) return true; }
            else if(kind==2) { if((abs(dx)==1 && abs(dy)==2)||(abs(dx)==2 && abs(dy)==1)) return true; }
            else if(kind==6) { if(abs(dx)<=1 && abs(dy)<=1 && (dx!=0||dy!=0)) return true; }
            else if((kind==3 && abs(dx)==abs(dy)) || (kind==4 && (dx==0||dy==0)) || (kind==5 && (dx==0||dy==0||abs(dx)==abs(dy)))) {
                if((dx!=0||dy!=0) && clear(b,s,target)) return true;
            }
        } return false;
    }
    function clear(uint256 b,uint8 from,uint8 to) private pure returns(bool) {
        int256 fx=int256(uint256(from%8)); int256 fy=int256(uint256(from/8));
        int256 tx=int256(uint256(to%8)); int256 ty=int256(uint256(to/8));
        int256 sx=tx>fx ? int256(1):tx<fx ? int256(-1):int256(0);
        int256 sy=ty>fy ? int256(1):ty<fy ? int256(-1):int256(0);
        fx+=sx; fy+=sy;
        while(fx!=tx || fy!=ty) { if(piece(b,uint8(uint256(fy*8+fx)))!=0) return false; fx+=sx; fy+=sy; }
        return true;
    }
    function inCheck(Position memory p,bool sideBlack) internal pure returns(bool) {
        uint8 king=sideBlack ? 14:6;
        for(uint8 s=0;s<64;s++) if(piece(p.board,s)==king) return attacked(p.board,s,!sideBlack);
        return true; // Missing king is never legal.
    }
    function tryMove(Position memory p,uint16 m) internal pure returns(bool ok, Position memory n) {
        n=Position(p.board,p.castling,64,p.halfmoveClock,p.blackToMove);
        if(m>=32768) return(false,n);
        uint8 from=uint8((m>>6)&63); uint8 to=uint8(m&63); uint8 promo=uint8(m>>12);
        if(from==to) return(false,n);
        uint8 v=piece(p.board,from); uint8 target=piece(p.board,to); uint8 kind=v&7;
        if(v==0 || black(v)!=p.blackToMove || (target!=0 && (black(target)==p.blackToMove || (target&7)==6))) return(false,n);
        int256 dx=int256(uint256(to%8))-int256(uint256(from%8)); int256 dy=int256(uint256(to/8))-int256(uint256(from/8));
        bool capture=target!=0; bool castle=false;
        if(kind==1) {
            int256 dir=p.blackToMove ? int256(-1):int256(1);
            if(dx==0 && dy==dir && target==0) {}
            else if(dx==0 && dy==dir*2 && from/8==(p.blackToMove ? 6:1) && target==0 && piece(p.board,uint8(uint256(int256(uint256(from))+dir*8)))==0) n.enPassant=uint8(uint256(int256(uint256(from))+dir*8));
            else if(abs(dx)==1 && dy==dir && target!=0) {}
            else if(abs(dx)==1 && dy==dir && to==p.enPassant && target==0) {
                uint8 cap=uint8(uint256(int256(uint256(to))-dir*8));
                if(piece(p.board,cap)!=(p.blackToMove ? 1:9)) return(false,n);
                n.board=put(n.board,cap,0); capture=true;
            } else return(false,n);
            if(to/8==(p.blackToMove ? 0:7)) { if(promo<2||promo>5) return(false,n); v=promo+(p.blackToMove ? 8:0); }
            else if(promo!=0) return(false,n);
        } else {
            if(promo!=0) return(false,n);
            if(kind==2) { if(!((abs(dx)==1&&abs(dy)==2)||(abs(dx)==2&&abs(dy)==1))) return(false,n); }
            else if(kind==3) { if(abs(dx)!=abs(dy)||!clear(p.board,from,to)) return(false,n); }
            else if(kind==4) { if((dx!=0&&dy!=0)||!clear(p.board,from,to)) return(false,n); }
            else if(kind==5) { if(!(dx==0||dy==0||abs(dx)==abs(dy))||!clear(p.board,from,to)) return(false,n); }
            else if(kind==6) {
                if(abs(dx)<=1 && abs(dy)<=1) {}
                else if(dy==0 && abs(dx)==2 && from==(p.blackToMove ? 60:4)) {
                    bool ks=dx>0; uint8 right=p.blackToMove ? (ks ? 4:8):(ks ? 1:2);
                    uint8 rookFrom=p.blackToMove ? (ks ? 63:56):(ks ? 7:0);
                    uint8 rookTo=ks ? from+1:from-1;
                    if((p.castling&right)==0 || piece(p.board,rookFrom)!=(p.blackToMove ? 12:4) || !clear(p.board,from,rookFrom) || inCheck(p,p.blackToMove)) return(false,n);
                    uint256 mid=put(put(p.board,from,0),rookTo,v);
                    if(attacked(mid,rookTo,!p.blackToMove)) return(false,n);
                    n.board=put(put(n.board,rookFrom,0),rookTo,p.blackToMove ? 12:4); castle=true;
                } else return(false,n);
            } else return(false,n);
        }
        n.board=put(put(n.board,from,0),to,v);
        if(kind==6) n.castling &= p.blackToMove ? uint8(3):uint8(12);
        if(from==0||to==0) n.castling &= 13;
        if(from==7||to==7) n.castling &= 14;
        if(from==56||to==56) n.castling &= 7;
        if(from==63||to==63) n.castling &= 11;
        if(inCheck(n,p.blackToMove)) return(false,n);
        n.halfmoveClock=(kind==1||capture) ? 0 : p.halfmoveClock+1;
        n.blackToMove=!p.blackToMove;
        castle; return(true,n);
    }
    function applyMove(Position memory p,uint16 m) internal pure returns(Position memory n) {
        bool ok; (ok,n)=tryMove(p,m); if(!ok) revert IllegalMove();
    }
    function hasLegalMove(Position memory p) internal pure returns(bool) {
        for(uint8 from=0;from<64;from++) {
            uint8 v=piece(p.board,from); if(v==0||black(v)!=p.blackToMove) continue;
            for(uint8 to=0;to<64;to++) {
                uint16 m=(uint16(from)<<6)|to;
                if((v&7)==1 && to/8==(p.blackToMove ? 0:7)) m|=uint16(5)<<12;
                (bool ok,)=tryMove(p,m); if(ok) return true;
            }
        } return false;
    }
    /// @notice Only positions whose deadness is certain from material alone.
    function insufficient(Position memory p) internal pure returns(bool) {
        uint256 minors; uint256 knights; uint8 bishopColour=2;
        for(uint8 s=0;s<64;s++) {
            uint8 kind=piece(p.board,s)&7;
            if(kind==0||kind==6) continue;
            if(kind==1||kind==4||kind==5) return false;
            minors++;
            if(kind==2) knights++;
            else { uint8 colour=(s/8+s%8)%2; if(bishopColour==2) bishopColour=colour; else if(bishopColour!=colour) return false; }
        }
        return minors<=1 || knights==0;
    }
    /// @notice Repetition EP field exists only when a legal en-passant capture exists.
    function key(Position memory p) internal pure returns(bytes32) {
        uint8 ep=64;
        if(p.enPassant<64) {
            uint8 target=p.enPassant;
            int256 back=p.blackToMove ? int256(8):int256(-8);
            for(int256 side=-1;side<=1;side+=2) {
                int256 s=int256(uint256(target))+back+side;
                if(s<0||s>=64||abs(int256(uint256(target%8))-int256(uint256(uint8(uint256(s))%8)))!=1) continue;
                uint8 from=uint8(uint256(s));
                if(piece(p.board,from)!=(p.blackToMove ? 9:1)) continue;
                (bool ok,)=tryMove(p,(uint16(from)<<6)|target); if(ok) { ep=target; break; }
            }
        }
        return keccak256(abi.encode(p.board,p.castling,ep,p.blackToMove));
    }
}

/// @dev Read-only differential test/deployment helper, independent of escrow.
contract HybridChessRulesView {
    function initial() external pure returns(HybridChessRules.Position memory) { return HybridChessRules.initial(); }
    function applyMove(HybridChessRules.Position memory p,uint16 move_) external pure returns(HybridChessRules.Position memory) { return HybridChessRules.applyMove(p,move_); }
    function status(HybridChessRules.Position memory p) external pure returns(bool check,bool legal,bool dead,bytes32 positionKey) {
        return(HybridChessRules.inCheck(p,p.blackToMove),HybridChessRules.hasLegalMove(p),HybridChessRules.insufficient(p),HybridChessRules.key(p));
    }
}
