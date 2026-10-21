// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Signed Q32 arithmetic; explicit finite approximation, not IEEE float32.
library FixedMath {
    int256 internal constant ONE = 4294967296;
    int256 internal constant LN2 = 2977044472;
    int256 internal constant PI = 13493037705;
    int256 internal constant TAU = 26986075409;
    error NumericRange();

    function mul(int256 a, int256 b) internal pure returns (int256) { return a*b/ONE; }

    function exp(int256 x) internal pure returns (int256) {
        if (x <= -32*ONE) return 0;
        if (x > 20*ONE) revert NumericRange();
        int256 n = x/LN2;
        if (x < 0 && x%LN2 != 0) --n;
        int256 r=x-n*LN2;
        int256 total=ONE;
        int256 term=ONE;
        for (int256 k=1;k<14;++k) { term=mul(term,r)/k; total+=term; }
        return n>=0 ? total<<uint256(n) : total>>uint256(-n);
    }

    function log(int256 x) internal pure returns (int256) {
        if (x<=0) revert NumericRange();
        int256 n;
        while (x>=2*ONE) { x>>=1; ++n; }
        while (x<ONE) { x<<=1; --n; }
        int256 y=(x-ONE)*ONE/(x+ONE);
        int256 y2=mul(y,y);
        int256 term=y;
        int256 total=y;
        for (int256 k=3;k<28;k+=2) { term=mul(term,y2); total+=term/k; }
        return 2*total+n*LN2;
    }

    function silu(int256 x) internal pure returns (int256) {
        if (x>=20*ONE) return x;
        if (x<=-32*ONE) return 0;
        if (x<0) { int256 e=exp(x); return x*e/(ONE+e); }
        return x*ONE/(ONE+exp(-x));
    }

    function softplus(int256 x) internal pure returns (int256) {
        return x>=20*ONE ? x : log(ONE+exp(x));
    }

    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x==0) return 0;
        y=x;
        uint256 z=(x+1)>>1;
        while (z<y) { y=z; z=(x/z+z)>>1; }
    }

    function sincos(int256 x) internal pure returns (int256 s,int256 c) {
        x%=TAU;
        if (x<0) x+=TAU;
        if (x>PI) x-=TAU;
        s=x; c=ONE;
        int256 ts=x;
        int256 tc=ONE;
        for (int256 k=1;k<15;++k) {
            ts=-mul(mul(ts,x),x)/((2*k)*(2*k+1));
            tc=-mul(mul(tc,x),x)/((2*k-1)*(2*k));
            s+=ts; c+=tc;
        }
    }

    function bf16(bytes memory b,uint256 i) internal pure returns (int256) {
        uint256 v=uint8(b[2*i])|(uint256(uint8(b[2*i+1]))<<8);
        uint256 e=(v>>7)&255;
        if (e==255) revert NumericRange();
        uint256 m=(v&127)+(e==0 ? 0 : 128);
        int256 shift=e==0 ? int256(-101) : int256(e)-102;
        uint256 a=shift>=0 ? m<<uint256(shift) : m>>uint256(-shift);
        return v&32768!=0 ? -int256(a) : int256(a);
    }
}
