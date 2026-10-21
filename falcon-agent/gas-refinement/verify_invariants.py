"""Independent big-integer checks for signed extraction and two-step dilation."""
import json,random
from pathlib import Path
ROOT=Path(__file__).resolve().parent
MOD=1<<256;MASK=MOD-1
SPREAD=sum(1<<(52*j) for j in range(4))
M12=sum(0xfff<<(64*j) for j in range(4))
M6=sum(63<<(32*j) for j in range(8))

def spread(v):return (((v*SPREAD)&M12)*((1<<26)+1))&M6

def signed_dot(w,x):
 total=0
 for start in range(0,64,8):
  codes=sum(w[start+i]<<(6*i) for i in range(8))
  xp=sum(x[start+i]<<(32*(7-i)) for i in range(8))
  total+=spread(codes)*xp
 y=(total+(1<<223))&MASK
 return (y-MOD if y>>(255) else y)>>224

def main():
 rng=random.Random(10202026);dilations=0;cases=0
 for v in [0,(1<<48)-1]+[1<<i for i in range(48)]+[rng.randrange(1<<48) for _ in range(10000)]:
  assert spread(v)==sum(((v>>(6*i))&63)<<(32*i) for i in range(8));dilations+=1
 for i in range(10000):
  x=[rng.randrange(-32768,32768) for _ in range(64)];w=[rng.randrange(64) for _ in range(64)]
  if i<64:x=[-32768 if i&1 else 32767]*64;w=[63]*64
  assert signed_dot(w,x)==sum(a*b for a,b in zip(w,x));cases+=1
 result={'status':'completed','seed':10202026,'dilation_cases':dilations,'signed_dot_cases':cases,'maximum_absolute_coefficient':64*63*32768,'signed_lane_bits':32,'rounding_guard_bit':223,'all_exact':True}
 (ROOT/'invariant-results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':main()
