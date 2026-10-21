// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {WeightReader} from "../fourbit-study/WeightReader.sol";
import {FixedMath as F} from "./FixedMath.sol";
import {PrepaidBudget} from "./PrepaidBudget.sol";

interface IFourBitKernel {
    function dotFile(address index,uint256 offset,bytes calldata x,uint256 first,uint256 rows,uint256 cols)
        external view returns (int256[] memory);
}

/// @notice Bounded, resumable, requester-paid Falcon-H1-Tiny four-bit inference.
/// @dev Token IDs in/out; tokenization and display are client operations. Q32
/// activations plus adaptive int16 linear inputs are an additional approximation.
/// No trusted off-chain intermediate values or administrator. Prepaid requests
/// require an executor to submit continuation transactions; nothing runs itself.
contract GH0STRuntime is PrepaidBudget {
    int256 constant ONE=4294967296;
    uint256 public constant MAX_CONTEXT=64;
    uint256 constant GAS_FLOOR=10000000;
    bytes32 public constant WEIGHTS_SHA256=0x9cc5e90880d96ff15bf4110f7970a7ea473c9b86576298691ade1e745672e7a9;
    bytes32 public constant KERNEL_HASH=0x4712cc155846d065fa53ed92ead537e9912e53a44ecaf53cb9bc36aeadcf7e4b;
    bytes32 public constant INDEX_HASH=0x837bbe58f9d52bb20e8198019a10b97e706aab9cb9e400ca229b6d1cb390c307;
    IFourBitKernel public immutable kernel;
    address public immutable index;
    uint256 public nextSession;

    uint256 constant H=0;
    uint256 constant N=512;
    uint256 constant P=1024;
    uint256 constant CV=2816;
    uint256 constant M=3712;
    uint256 constant MO=4480;
    uint256 constant Q=4992;
    uint256 constant K=5504;
    uint256 constant V=5632;
    uint256 constant ATT=5760;
    uint256 constant AO=6272;
    uint256 constant G=6784;
    uint256 constant UP=7552;
    uint256 constant FF=8320;
    uint256 constant DOWN=9088;
    uint256 constant DT=9600;
    uint256 constant A=9632;
    uint256 constant D=9664;
    uint256 constant DOTS=9728;

    struct Session {
        address requester;
        uint8 phase;
        uint8 layer;
        uint16 position;
        uint16 cursor;
        uint16 maxNewTokens;
        uint32 currentToken;
        uint32 bestToken;
        int256 bestScore;
        uint32[] prompt;
        uint32[] generated;
        bytes matrixInput;
        int256 matrixScale;
        mapping(uint256=>uint256) words;
    }
    mapping(uint256=>Session) internal sessions;
    error InvalidInput();
    error Unauthorized();
    error NoWork();
    error NumericRange();

    event SessionStarted(uint256 indexed id,address indexed requester,uint256 promptTokens,uint256 maxNewTokens);
    event Progress(uint256 indexed id,uint256 position,uint256 layer,uint256 phase,uint256 cursor);
    event LayerComputed(uint256 indexed id,uint256 position,uint256 layer,bytes32 stateHash);
    event Token(uint256 indexed id,uint256 sequenceIndex,uint32 tokenId);
    event Finished(uint256 indexed id,uint8 reason);

    constructor(address kernel_,address index_) {
        if ((block.chainid!=4663 && block.chainid!=31337) ||
            kernel_.codehash!=KERNEL_HASH || index_.codehash!=INDEX_HASH) revert InvalidInput();
        kernel=IFourBitKernel(kernel_); index=index_;
    }

    /// @notice Worst-case bounded work, including maximum output length, no EOS.
    /// Every processed position has one embedding plus 24 * 90 layer units.
    /// Each generated token adds final normalization and 128 output tiles.
    function quote(uint256 promptTokens,uint16 maxNewTokens,uint256 gasPriceCap,uint256 postingFeeCap)
        public pure returns (uint256 maximumUnits,uint256 executionGasCap,uint256 budgetWei) {
        if (promptTokens==0 || maxNewTokens==0 || promptTokens+maxNewTokens>MAX_CONTEXT) revert InvalidInput();
        maximumUnits=(promptTokens+maxNewTokens-1)*2161+uint256(maxNewTokens)*129;
        (executionGasCap,budgetWei)=_budgetQuote(maximumUnits,gasPriceCap,postingFeeCap);
    }

    function startPrepaid(uint32[] calldata prompt,uint16 maxNewTokens,address executor,
                          uint256 gasPriceCap,uint256 postingFeeCap,uint256 expectedBudgetWei)
        external payable guarded returns (uint256 id) {
        (uint256 maximumUnits,,)=quote(prompt.length,maxNewTokens,gasPriceCap,postingFeeCap);
        if (prompt.length==0 || maxNewTokens==0 || prompt.length+maxNewTokens>MAX_CONTEXT) revert InvalidInput();
        id=nextSession++;
        _fund(id,executor,maximumUnits,gasPriceCap,postingFeeCap,expectedBudgetWei);
        Session storage s=sessions[id];
        s.requester=msg.sender; s.maxNewTokens=maxNewTokens;
        for (uint256 i;i<prompt.length;++i) {
            if (prompt[i]>=32768) revert InvalidInput();
            s.prompt.push(prompt[i]);
        }
        s.currentToken=prompt[0];
        emit SessionStarted(id,msg.sender,prompt.length,maxNewTokens);
    }

    function advancePrepaid(uint256 id,uint256 maxUnits) external guarded returns (uint256 units) {
        uint256 initialGas=gasleft();
        uint256 postingFee=_checkExecutor(id);
        Session storage s=sessions[id];
        if (s.phase==255 || maxUnits==0 || maxUnits>256) revert InvalidInput();
        while (units<maxUnits && s.phase!=255 && gasleft()>GAS_FLOOR) { _unit(id,s); ++units; }
        if (units==0) revert NoWork();
        emit Progress(id,s.position,s.layer,s.phase,s.cursor);
        _charge(id,initialGas,units,postingFee,s.phase==255);
    }

    function setExecutor(uint256 id,address executor) external guarded { _setExecutor(id,executor); }

    function cancel(uint256 id) external guarded {
        Session storage s=sessions[id];
        if (s.requester!=msg.sender) revert Unauthorized();
        if (s.phase==255) revert InvalidInput();
        s.phase=255; emit Finished(id,3);
        _refund(id);
    }

    function status(uint256 id) external view returns
        (address requester,uint256 position,uint256 layer,uint256 phase,uint256 cursor,uint256 promptLength,uint32[] memory generated) {
        Session storage s=sessions[id];
        return (s.requester,s.position,s.layer,s.phase,s.cursor,s.prompt.length,s.generated);
    }

    /// @notice Public deterministic numerical checkpoint inspection; no private conversations.
    function values(uint256 id,uint256 base,uint256 count) external view returns (int256[] memory) {
        if (count>2048 || (base&3)!=0 || (count&3)!=0) revert InvalidInput();
        return _load(sessions[id],base,count);
    }

    function _get(Session storage s,uint256 base,uint256 i) internal view returns (int256) {
        uint256 p=base+i;
        return int256(int64(uint64(s.words[p>>2]>>((p&3)*64))));
    }

    function _load(Session storage s,uint256 base,uint256 count) internal view returns (int256[] memory out) {
        out=new int256[](count);
        for (uint256 i;i<count;i+=4) {
            uint256 word=s.words[(base+i)>>2];
            assembly ("memory-safe") {
                let p := add(add(out,32),mul(i,32))
                mstore(p,signextend(7,word))
                mstore(add(p,32),signextend(7,shr(64,word)))
                mstore(add(p,64),signextend(7,shr(128,word)))
                mstore(add(p,96),signextend(7,shr(192,word)))
            }
        }
    }

    function _store(Session storage s,uint256 base,int256[] memory x) internal {
        if ((base&3)!=0 || (x.length&3)!=0) revert InvalidInput();
        for (uint256 i;i<x.length;i+=4) {
            uint256 word;
            bool valid;
            assembly ("memory-safe") {
                let p := add(add(x,32),mul(i,32))
                let a := mload(p)
                let b := mload(add(p,32))
                let c := mload(add(p,64))
                let d := mload(add(p,96))
                valid := and(and(eq(signextend(7,a),a),eq(signextend(7,b),b)),
                             and(eq(signextend(7,c),c),eq(signextend(7,d),d)))
                let mask := 0xffffffffffffffff
                word := or(or(and(a,mask),shl(64,and(b,mask))),
                           or(shl(128,and(c,mask)),shl(192,and(d,mask))))
            }
            if (!valid) revert NumericRange();
            s.words[(base+i)>>2]=word;
        }
    }

    function _offset(uint256 tensor) internal view returns (uint256 offset) {
        bytes memory b=WeightReader.read(index,16+tensor*32,4);
        assembly ("memory-safe") { offset := shr(224,mload(add(b,32))) }
    }

    function _bf(uint256 tensor,uint256 first,uint256 count) internal view returns (int256[] memory out) {
        bytes memory b=WeightReader.read(index,_offset(tensor)+2*first,2*count);
        out=new int256[](count);
        for (uint256 i;i<count;++i) out[i]=F.bf16(b,i);
    }

    function _next(Session storage s) internal { ++s.phase; s.cursor=0; }
    function _hist(Session storage s,uint256 pos) internal view returns (uint256) {
        return 2000000+uint256(s.layer)*MAX_CONTEXT*864+pos*864;
    }
    function _kv(Session storage s,uint256 pos) internal view returns (uint256) {
        return 4000000+uint256(s.layer)*MAX_CONTEXT*256+pos*256;
    }

    function _embed(Session storage s) internal {
        uint256 offset=_offset(0);
        bytes memory head=WeightReader.read(index,offset,16);
        uint256 groups;
        uint256 unit;
        assembly ("memory-safe") {
            groups := and(shr(192,mload(add(head,32))),0xffffffff)
        }
        // The final four header bytes are the Q24 scale unit.
        unit=(uint256(uint8(head[12]))<<24)|(uint256(uint8(head[13]))<<16)|
             (uint256(uint8(head[14]))<<8)|uint8(head[15]);
        uint256 first=uint256(s.currentToken)*8;
        bytes memory meta=WeightReader.read(index,offset+16+first*2,16);
        bytes memory codes=WeightReader.read(index,offset+16+groups*2+first*32,256);
        int256[] memory out=new int256[](512);
        for (uint256 i;i<512;++i) {
            uint256 g=i/64;
            uint256 record=(uint256(uint8(meta[g*2]))<<8)|uint8(meta[g*2+1]);
            uint256 cp=(i/8)*4;
            uint256 code;
            assembly ("memory-safe") { code := and(shr(mul(mod(i,8),4),shr(224,mload(add(add(codes,32),cp)))),15) }
            int256 w=(int256(code)-int256(record&15))*int256(record>>4)*int256(unit);
            out[i]=w*227/8;
        }
        _store(s,H,out); _next(s);
    }

    function _norm(Session storage s,uint256 input,uint256 tensor) internal {
        int256[] memory x=_load(s,input,512);
        int256[] memory w=_bf(tensor,0,512);
        uint256 variance;
        for (uint256 i;i<512;++i) variance+=uint256(x[i]*x[i]);
        int256 root=int256(F.sqrt(variance/512+184467440737095));
        for (uint256 i;i<512;++i) x[i]=F.mul(x[i]*ONE/root,w[i]);
        _store(s,N,x); _next(s);
    }

    function _prepareMatrix(Session storage s,uint256 input,uint256 cols) internal {
        int256[] memory x=_load(s,input,cols);
        int256 maximum=1;
        bytes memory packed=new bytes(cols*2);
        // Storage inputs have already passed the int64 range check.
        unchecked {
            for (uint256 i;i<cols;++i) { int256 a=x[i]<0 ? -x[i] : x[i]; if (a>maximum) maximum=a; }
            for (uint256 i;i<cols;++i) {
                int256 a=x[i]<0 ? -x[i] : x[i];
                int256 v=(a*32767+maximum/2)/maximum;
                if (x[i]<0) v=-v;
                assembly ("memory-safe") {
                    let p := add(add(packed,32),mul(i,2))
                    mstore8(p,shr(8,v))
                    mstore8(add(p,1),v)
                }
            }
        }
        s.matrixInput=packed; s.matrixScale=maximum;
    }

    function _matrix(Session storage s,uint256 tensor,uint256 input,uint256 output,uint256 cols,uint256 rows) internal {
        if (s.cursor==0) _prepareMatrix(s,input,cols);
        uint256 count=256;
        if (count>rows-s.cursor) count=rows-s.cursor;
        int256[] memory y=kernel.dotFile(index,_offset(tensor),s.matrixInput,s.cursor,count,cols);
        if (s.phase==22) {
            if (s.cursor==0) s.bestScore=type(int256).min;
            for (uint256 i;i<count;++i) if (y[i]>s.bestScore) {
                s.bestScore=y[i]; s.bestToken=uint32(uint256(s.cursor)+i);
            }
        } else {
            int256 maximum=s.matrixScale;
            for (uint256 i;i<count;++i) y[i]=y[i]*maximum/(32767*16777216);
            _store(s,output+s.cursor,y);
        }
        s.cursor+=uint16(count);
        if (s.cursor==rows && s.phase!=22) _next(s);
    }

    function _conv(Session storage s) internal {
        uint256 first=s.cursor;
        uint256 count=64;
        int256[] memory weights=_bf(16*uint256(s.layer)+7,first*4,count*4);
        int256[] memory bias=_bf(16*uint256(s.layer)+8,first,count);
        int256[] memory raw=_load(s,P+768+first,count);
        int256[] memory out=new int256[](count);
        uint256 ring=1000000+uint256(s.layer)*4096;
        for (uint256 i;i<count;++i) {
            int256 v=bias[i];
            for (uint256 j;j<4;++j) {
                uint256 lag=3-j;
                int256 old=lag==0 ? raw[i] : uint256(s.position)>=lag ?
                    _get(s,ring+((uint256(s.position)-lag)%4)*896,first+i) : int256(0);
                v+=F.mul(old,weights[4*i+j]);
            }
            out[i]=F.silu(v);
        }
        _store(s,ring+(uint256(s.position)%4)*896+first,raw);
        _store(s,CV+first,out);
        s.cursor+=uint16(count); if (s.cursor==896) _next(s);
    }

    function _mambaPrep(Session storage s) internal {
        uint256 b=16*uint256(s.layer);
        int256[] memory bias=_bf(b+4,0,24);
        int256[] memory a=_bf(b+5,0,24);
        int256[] memory d=_bf(b+6,0,24);
        int256[] memory dt=_load(s,P+1664,24);
        int256[] memory prefix=new int256[](24);
        for (uint256 h;h<24;++h) {
            dt[h]=F.softplus(dt[h]+bias[h]); a[h]=F.exp(a[h]);
            prefix[h]=dt[h]+(s.position==0 ? int256(0) : _get(s,_hist(s,s.position-1)+832,h));
        }
        _store(s,DT,dt); _store(s,A,a); _store(s,D,d);
        _store(s,_hist(s,s.position)+768,_load(s,CV+768,64));
        _store(s,_hist(s,s.position)+832,prefix);
        _next(s);
    }

    function _saveU(Session storage s) internal {
        int256[] memory u=_load(s,CV+s.cursor,64);
        for (uint256 i;i<64;++i) u[i]=F.mul(u[i],_get(s,DT,(uint256(s.cursor)+i)/32));
        _store(s,_hist(s,s.position)+s.cursor,u);
        s.cursor+=64; if (s.cursor==768) _next(s);
    }

    function _historyDots(Session storage s) internal {
        int256[] memory c=_load(s,CV+832,64);
        int256[] memory dots=new int256[](64);
        for (uint256 pos;pos<=s.position;++pos) {
            int256[] memory b=_load(s,_hist(s,pos)+768,64);
            int256 sum;
            for (uint256 i;i<64;++i) sum+=b[i]*c[i];
            dots[pos]=sum/ONE;
        }
        _store(s,DOTS,dots); _next(s);
    }

    function _mambaHead(Session storage s) internal {
        uint256 h=s.cursor;
        int256 a=_get(s,A,h);
        int256 prefix=_get(s,_hist(s,s.position)+832,h);
        int256[] memory out=new int256[](32);
        for (uint256 pos;pos<=s.position;++pos) {
            int256 previous=_get(s,_hist(s,pos)+832,h);
            int256 coefficient=F.mul(F.exp(-F.mul(a,prefix-previous)),_get(s,DOTS,pos));
            int256[] memory u=_load(s,_hist(s,pos)+h*32,32);
            for (uint256 j;j<32;++j) out[j]+=F.mul(coefficient,u[j]);
        }
        int256 d=_get(s,D,h);
        for (uint256 j;j<32;++j) {
            uint256 i=h*32+j;
            out[j]=F.mul(out[j]+F.mul(_get(s,CV,i),d),F.silu(_get(s,P,i)));
        }
        _store(s,M+h*32,out);
        ++s.cursor; if (s.cursor==24) _next(s);
    }

    function _rope(Session storage s) internal {
        int256[] memory q=_load(s,Q,512);
        int256[] memory k=_load(s,K,128);
        bytes memory frequencies=INV_FREQ;
        for (uint256 i;i<32;++i) {
            uint256 freq;
            assembly ("memory-safe") { freq := shr(184,mload(add(add(frequencies,32),mul(i,9)))) }
            (int256 sine,int256 cosine)=F.sincos(int256(uint256(s.position)*freq>>32));
            for (uint256 h;h<8;++h) {
                uint256 p=h*64+i;
                int256 x=q[p]; int256 y=q[p+32];
                q[p]=F.mul(x,cosine)-F.mul(y,sine);
                q[p+32]=F.mul(y,cosine)+F.mul(x,sine);
                if (h<2) {
                    x=k[p]; y=k[p+32];
                    k[p]=F.mul(x,cosine)-F.mul(y,sine);
                    k[p+32]=F.mul(y,cosine)+F.mul(x,sine);
                }
            }
        }
        _store(s,Q,q); _store(s,_kv(s,s.position),k);
        _store(s,_kv(s,s.position)+128,_load(s,V,128));
        _next(s);
    }

    function _attentionHead(Session storage s) internal {
        uint256 h=s.cursor;
        uint256 kh=(h/4)*64;
        int256[] memory q=_load(s,Q+h*64,64);
        int256[] memory probabilities=new int256[](uint256(s.position)+1);
        int256 maximum=type(int256).min;
        for (uint256 pos;pos<=s.position;++pos) {
            int256[] memory k=_load(s,_kv(s,pos)+kh,64);
            int256 score;
            for (uint256 j;j<64;++j) score+=q[j]*k[j];
            score/=8*ONE;
            probabilities[pos]=score; if (score>maximum) maximum=score;
        }
        int256 denominator;
        for (uint256 pos;pos<=s.position;++pos) {
            probabilities[pos]=F.exp(probabilities[pos]-maximum);
            denominator+=probabilities[pos];
        }
        int256[] memory out=new int256[](64);
        for (uint256 pos;pos<=s.position;++pos) {
            int256[] memory v=_load(s,_kv(s,pos)+128+kh,64);
            for (uint256 j;j<64;++j) out[j]+=probabilities[pos]*v[j];
        }
        for (uint256 j;j<64;++j) out[j]/=denominator;
        _store(s,ATT+h*64,out);
        ++s.cursor; if (s.cursor==8) _next(s);
    }

    function _residualNorm(Session storage s) internal {
        int256[] memory x=_load(s,H,512);
        int256[] memory mo=_load(s,MO,512);
        int256[] memory ao=_load(s,AO,512);
        for (uint256 i;i<512;++i) x[i]+=mo[i]+ao[i];
        _store(s,H,x);
        _norm(s,H,16*uint256(s.layer)+16);
    }

    function _gatedMLP(Session storage s) internal {
        int256[] memory gate=_load(s,G+s.cursor,256);
        int256[] memory up=_load(s,UP+s.cursor,256);
        for (uint256 i;i<256;++i) gate[i]=F.mul(F.silu(gate[i]),up[i]);
        _store(s,FF+s.cursor,gate);
        s.cursor+=256; if (s.cursor==768) _next(s);
    }

    function _layerFinish(uint256 id,Session storage s) internal {
        int256[] memory h=_load(s,H,512);
        int256[] memory down=_load(s,DOWN,512);
        for (uint256 i;i<512;++i) h[i]+=down[i];
        _store(s,H,h);
        emit LayerComputed(id,s.position,s.layer,keccak256(abi.encode(h)));
        s.cursor=0;
        if (s.layer<23) { ++s.layer; s.phase=1; }
        else if (uint256(s.position)+1<s.prompt.length) {
            ++s.position; s.currentToken=s.prompt[s.position]; s.layer=0; s.phase=0;
        } else s.phase=21;
    }

    function _emitToken(uint256 id,Session storage s) internal {
        s.generated.push(s.bestToken);
        emit Token(id,s.generated.length-1,s.bestToken);
        if (s.bestToken==11 || s.generated.length==s.maxNewTokens) {
            s.phase=255; emit Finished(id,s.bestToken==11 ? 1 : 2);
        } else {
            ++s.position; s.currentToken=s.bestToken; s.layer=0; s.phase=0; s.cursor=0;
        }
    }

    function _unit(uint256 id,Session storage s) internal {
        uint256 p=s.phase;
        uint256 b=16*uint256(s.layer);
        if (p==0) _embed(s);
        else if (p==1) _norm(s,H,b+15);
        else if (p==2) _matrix(s,b+9,N,P,512,1688);
        else if (p==3) _conv(s);
        else if (p==4) _mambaPrep(s);
        else if (p==5) _saveU(s);
        else if (p==6) _historyDots(s);
        else if (p==7) _mambaHead(s);
        else if (p==8) _matrix(s,b+10,M,MO,768,512);
        else if (p==9) _matrix(s,b+11,N,Q,512,512);
        else if (p==10) _matrix(s,b+12,N,K,512,128);
        else if (p==11) _matrix(s,b+13,N,V,512,128);
        else if (p==12) _rope(s);
        else if (p==13) _attentionHead(s);
        else if (p==14) _matrix(s,b+14,ATT,AO,512,512);
        else if (p==15) _residualNorm(s);
        else if (p==16) _matrix(s,b+1,N,G,512,768);
        else if (p==17) _matrix(s,b+2,N,UP,512,768);
        else if (p==18) _gatedMLP(s);
        else if (p==19) _matrix(s,b+3,FF,DOWN,768,512);
        else if (p==20) _layerFinish(id,s);
        else if (p==21) _norm(s,H,385);
        else if (p==22) {
            _matrix(s,0,N,0,512,32768);
            if (s.cursor==32768) _emitToken(id,s);
        } else revert InvalidInput();
    }

    // 32 Q64 inverse RoPE frequencies, nine bytes each (the first is exactly 2**64).
    bytes constant INV_FREQ=hex"0100000000000000000074022fc042280000003491fb4b03dd72000017d298d03c8b7700000acba1551b3886800004e45cb55121a2c000023784b47bbc55800001012cfaad0da1300000748a93e8c5beb0000034cfc9d798a08e000017ee9aef1463bb00000ad8528852b0b3000004ea1d1c46bb1b0000023a1fefb6787c000001025b573696510000007513986c36d2000000350de10ebf9f000000180abdfbd5620000000ae512a79fce00000004efe44656c4000000023cbe3b67f800000001038b173ca300000000759d3e071d00000000354c4145e8000000001827021d37000000000af1e1c48e0000000004f5b23b7400000000023f5f9b2b000000000104bc3c610000000000762785770000000000358aead300000000001843677a";
}
