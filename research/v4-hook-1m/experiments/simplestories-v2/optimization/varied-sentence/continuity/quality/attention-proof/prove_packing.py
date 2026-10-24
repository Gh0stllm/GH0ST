"""Pure arithmetic property checks for proposed exact attention dot packing.

No Solidity, model, or chain state is modified. Multiplication is explicitly
reduced modulo2^256 before extracting the EVM-visible coefficient.
"""
import hashlib
import json
from pathlib import Path
import random

OUT=Path(__file__).resolve().parent
MASK=(1<<256)-1
B=1<<29
Q20=1<<20


def pack(values,reverse=False):
    return sum(v << (64*(3-i if reverse else i)) for i,v in enumerate(values))


def sdiv(value,divisor):
    return (1 if value>=0 else -1)*(abs(value)//divisor)


def score(a,b):
    assert all(-B<=x<B for x in a+b)
    raw=((pack([x+B for x in a])*pack([x+B for x in b],True))&MASK)>>192
    corrected=raw-B*(sum(a)+sum(b))-4*B*B
    expected=sum(x*y for x,y in zip(a,b))
    assert corrected==expected,(a,b,raw,corrected,expected)
    assert sdiv(corrected,23170)==sdiv(expected,23170)


def weighted(probabilities,values,bias):
    assert all(0<=p<=Q20 for p in probabilities)
    assert all(-bias<=v<bias for v in values)
    raw=((pack(probabilities)*pack([v+bias for v in values],True))&MASK)>>192
    corrected=raw-bias*sum(probabilities)
    expected=sum(p*v for p,v in zip(probabilities,values))
    assert corrected==expected,(probabilities,values,raw,corrected,expected)
    if sum(probabilities):assert sdiv(corrected,sum(probabilities))==sdiv(expected,sum(probabilities))


def main():
    rng=random.Random(20261024)
    boundaries=[-B,-B+1,-1,0,1,B-2,B-1]
    score_boundary=0;weighted_boundary=0
    for a in boundaries:
        for b in boundaries:
            for x,y in [([a]*4,[b]*4),([a,b,a,b],[b,a,b,a]),([a,0,-1,b],[b,1,0,a])]:
                score(x,y);score_boundary+=1
    for _ in range(10000):
        score([rng.randrange(-B,B) for _ in range(4)],[rng.randrange(-B,B) for _ in range(4)])
    for bias in [B,1<<31]:
        values=[-bias,-bias+1,-1,0,1,bias-2,bias-1]
        for p in [0,1,Q20-1,Q20]:
            for v in values:
                weighted([p]*4,[v]*4,bias);weighted_boundary+=1
                weighted([p,Q20-p,0,Q20],[v,-1,0,bias-1],bias);weighted_boundary+=1
        for _ in range(10000):
            weighted([rng.randrange(Q20+1) for _ in range(4)],[rng.randrange(-bias,bias) for _ in range(4)],bias)
    score_max=4*((2*B)-1)**2
    weighted_max29=4*Q20*((2*B)-1)
    weighted_max31=4*Q20*((1<<32)-1)
    assert score_max < 1<<62
    assert weighted_max29 < 1<<52
    assert weighted_max31 < 1<<54
    result={'scope':'Offline pure arithmetic proposal proof; no model or Solidity changes and no gas claims.',
        'status':'PASS','random_seed':20261024,'score_bias':str(B),
        'score_random_cases':10000,'score_boundary_cases':score_boundary,
        'weighted_random_cases':20000,'weighted_boundary_cases':weighted_boundary,
        'score_input_interval':['-2^29','2^29-1'],
        'probability_interval':['0','2^20'],
        'weighted_value_intervals':[['-2^29','2^29-1'],['-2^31','2^31-1']],
        'operations_verified':['four-lane64-bit packing','modulo2^256 multiplication before coefficient extraction',
            'reverse-lane coefficient3 extraction','exact signed bias correction','signed division truncation towardzero'],
        'bounds':{'score_coefficient_max':str(score_max),'score_coefficient_below_bits':62,
            'weighted_bias29_coefficient_max':str(weighted_max29),'weighted_bias29_below_bits':52,
            'weighted_bias31_coefficient_max':str(weighted_max31),'weighted_bias31_below_bits':54},
        'formulas':{'score':'high64(pack(q+B)*reversePack(k+B) mod2^256) - B*(sum(q)+sum(k)) - 4*B^2',
            'weighted':'high64(pack(p)*reversePack(v+B) mod2^256) - B*sum(p)'},
        'notes':['The attention exponential table is Q20 with maximum1,048,576, not Q16.',
            'Score fastpath must guard both query and key values outside[-2^29,2^29-1].',
            'Weighted-value packing with bias2^31 covers the complete signed-int32 range without a fallback.',
            'Final partial groups must pad signed inputs withzero before applying their biases.',
            'Zero total probability still requires the existing division-by-zero behavior.',
            'Arithmetic equality does not establish that a Solidity implementation is faster; packing and memory access costs must be benchmarked.'],
        'source_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (OUT/'packing-proof.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))


if __name__=='__main__':main()
