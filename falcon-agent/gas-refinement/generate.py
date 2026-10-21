"""Generate inspectable research candidates from the preserved baseline."""
from pathlib import Path
ROOT=Path(__file__).resolve().parent
base=(ROOT.parent/'sixbit-optimization/SixBitFast.sol').read_text()
signed=base.replace('contract SixBitFast','contract SixBitSigned')
a=signed.index('                let sumw := v');b=signed.index('\n            }',a)
ops='\n'.join(f'                total := add(total,mul(wide(add(cp,{6*i})),mload(add(pp,{32*i}))))' for i in range(1,8))
signed=signed[:a]+ops+'\n                answer := sar(224,add(total,0x80000000000000000000000000000000000000000000000000000000))'+signed[b:]
signed=signed.replace('mstore(add(pp,add(mul(gc,288),mul(b,32))),v)','mstore(add(pp,add(mul(gc,288),mul(b,32))),sub(v,0x800000008000000080000000800000008000000080000000800000008000))')
signed=signed.replace('/// @notice Dedicated compact-matrix path, avoiding strategy branches/stack spills.','/// @notice Exact signed-polynomial dot product; no per-weight-group bias correction.')
(ROOT/'SixBitSigned.sol').write_text(signed)
# An aligned endpoint representation removes per-group bit-position extraction.
# It retains the two BF16 endpoints and all six-bit codes, with no requantization.
aligned=signed.replace('SixBitSigned','SixBitAligned')
aligned=aligned.replace('uint256 bits=uint8(w[12])+uint8(w[13]);','uint256 bits=32;')
old='if (bytes4(w)!=0x46364231 || uint8(w[12])==0 || uint8(w[13])==0 || uint8(w[12])>16 || uint8(w[13])>16 || w.length!=16+(g*bits+7)/8+g*48) revert InvalidInput();'
aligned=aligned.replace(old,'if (bytes4(w)!=0x47364231 || w.length!=16+g*52) revert InvalidInput();')
a=aligned.index('                let header := mload(wp)');b=aligned.index('                let d := sub(hi,lo)',a)
aligned=aligned[:a]+'''                let endpoints := shr(224,mload(add(add(wp,16),mul(gi,4))))
                lo := bf(shr(16,endpoints))
                let hi := bf(and(endpoints,65535))
'''+aligned[b:]
(ROOT/'SixBitAligned.sol').write_text(aligned)
# Baseline encoding with a scale-rounding fast path, validated within pinned bounds.
fast=signed.replace('SixBitSigned','SixBitBranch')
a=fast.index('                let q := div(d,63)');b=fast.index('\n                if iszero(step)',a)
fast=fast[:a]+'''                step := div(add(d,31),63)
                if iszero(lt(d,16515072)) {
                    let q := div(d,63)
                    let r := mod(d,63)
                    let radius := 1
                    if iszero(lt(q,524288)) { radius := 2 }
                    if iszero(lt(q,1048576)) { radius := 4 }
                    if and(iszero(lt(r,sub(32,radius))),iszero(gt(r,add(31,radius)))) { step := add(q,and(q,1)) }
                }'''+fast[b:]
(ROOT/'SixBitBranch.sol').write_text(fast)
# Dilation uses multiplication where shifted fields are disjoint.
mul=fast.replace('SixBitBranch','SixBitMul')
for var,shift in [('v',104),('result',52),('result',26)]:
 mul=mul.replace(f'or({var},shl({shift},{var}))',f'mul({var},{hex((1<<shift)+1)})')
(ROOT/'SixBitMul.sol').write_text(mul)
inline=mul.replace('SixBitMul','SixBitInline')
a=inline.index('                let v := wide(cp)');b=inline.index('\n                answer :=',a)
body='                let total := 0\n'
for i in range(8):
 body+='                {\n'+f'                    let v := shr(208,mload(add(cp,{6*i})))\n'
 for shift,mask in [(104,0xffffff00000000000000000000000000ffffff),(52,0xfff0000000000000fff0000000000000fff0000000000000fff),(26,0x3f0000003f0000003f0000003f0000003f0000003f0000003f0000003f)]:
  body+=f'                    v := and(mul(v,{hex((1<<shift)+1)}),{hex(mask)})\n'
 body+=f'                    total := add(total,mul(v,mload(add(pp,{32*i}))))\n'+'                }\n'
inline=inline[:a]+body.rstrip()+inline[b:]
(ROOT/'SixBitInline.sol').write_text(inline)
# Store the already-selected exact Q24 scale, avoiding BF16 high endpoint and
# float32-halfway reconstruction during every matrix call. Offset stays BF16.
direct=inline.replace('SixBitInline','SixBitDirect')
direct=direct.replace('uint256 bits=uint8(w[12])+uint8(w[13]);','uint256 bits=uint8(w[12])*8;')
direct=direct.replace(old,'if (bytes4(w)!=0x46364431 || (uint8(w[12])!=4 && uint8(w[12])!=5) || w.length!=16+g*uint8(w[12])+g*48) revert InvalidInput();')
a=direct.index('                let header := mload(wp)');b=direct.index('\n            }',a)
direct=direct[:a]+'''                let header := mload(wp)
                let stride := byte(12,header)
                let v := shr(sub(256,mul(stride,8)),mload(add(add(wp,16),mul(gi,stride))))
                lo := bf(add(and(shr(176,header),65535),shr(21,v)))
                step := and(v,2097151)'''+direct[b:]
(ROOT/'SixBitDirect.sol').write_text(direct)
pre=inline.replace('SixBitInline','SixBitPredecoded')
pre=pre.replace('uint256 bits=uint8(w[12])+uint8(w[13]);','uint256 bits=56;')
pre=pre.replace(old,'if (bytes4(w)!=0x46365031 || w.length!=16+g*55) revert InvalidInput();')
a=pre.index('                let header := mload(wp)');b=pre.index('\n            }',a)
pre=pre[:a]+'''                let v := shr(200,mload(add(add(wp,16),mul(gi,7))))
                lo := signextend(3,shr(24,v))
                step := and(v,16777215)'''+pre[b:]
(ROOT/'SixBitPredecoded.sol').write_text(pre)
# Four copies of a 48-bit word, separated by 52 bits, do not overlap.
# Masking the diagonal selects its four 12-bit chunks at 64-bit spacing.
# A second dilation splits each pair into separate 32-bit lanes.
for name in ['SixBitInline','SixBitDirect','SixBitPredecoded']:
 src=(ROOT/(name+'.sol')).read_text().replace(name,name+'2')
 before='''                    v := and(mul(v,0x100000000000000000000000001),0xffffff00000000000000000000000000ffffff)
                    v := and(mul(v,0x10000000000001),0xfff0000000000000fff0000000000000fff0000000000000fff)'''
 after=f'                    v := and(mul(v,{hex(sum(1<<(52*j) for j in range(4)))}),0xfff0000000000000fff0000000000000fff0000000000000fff)'
 assert src.count(before)==8,(name,src.count(before))
 src=src.replace(before,after)
 (ROOT/(name+'2.sol')).write_text(src)
shifted=(ROOT/'SixBitPredecoded2.sol').read_text().replace('SixBitPredecoded2','SixBitShifted')
shifted=shifted.replace('uint256 bits=56;','uint256 bits=uint8(w[8])*8;')
shifted=shifted.replace('if (bytes4(w)!=0x46365031 || w.length!=16+g*55) revert InvalidInput();','if (bytes4(w)!=0x46365331 || (uint8(w[8])!=4 && uint8(w[8])!=5) || uint8(w[9])>31 || uint8(w[10])==0 || uint8(w[10])>21 || w.length!=16+g*(48+uint8(w[8]))) revert InvalidInput();')
a=shifted.index('                let v := shr(200,mload');b=shifted.index('\n            }',a)
shifted=shifted[:a]+'''                let h := mload(wp)
                let stride := byte(8,h)
                let sb := byte(10,h)
                let v := mload(add(add(wp,16),mul(gi,stride)))
                lo := shl(byte(9,h),sar(sub(256,sub(mul(stride,8),sb)),v))
                step := and(shr(sub(256,mul(stride,8)),v),sub(shl(sb,1),1))'''+shifted[b:]
(ROOT/'SixBitShifted.sol').write_text(shifted)
# Fixed five-byte metadata: signed 19-bit offset coefficient plus 21-bit scale.
# A tensor/tile-wide power of two restores every original Q24 offset exactly.
fixed=(ROOT/'SixBitPredecoded2.sol').read_text().replace('SixBitPredecoded2','SixBitFixed')
fixed=fixed.replace('uint256 bits=56;','uint256 bits=40;')
fixed=fixed.replace('if (bytes4(w)!=0x46365031 || w.length!=16+g*55) revert InvalidInput();','if (bytes4(w)!=0x46364631 || uint8(w[8])>31 || w.length!=16+g*53) revert InvalidInput();')
a=fixed.index('                let v := shr(200,mload');b=fixed.index('\n            }',a)
fixed=fixed[:a]+'''                let v := mload(add(add(wp,16),mul(gi,5)))
                lo := shl(byte(8,mload(wp)),sar(237,v))
                step := and(shr(216,v),2097151)'''+fixed[b:]
(ROOT/'SixBitFixed.sol').write_text(fixed)
