#!/usr/bin/env python3
"""Independent exact proof/tests for eight signed products in32-bit EVM lanes."""
import hashlib
import itertools
import json
import random
from pathlib import Path

MASK=(1<<256)-1


def packed(h,w):
    assert len(h)==len(w)==8
    assert all(-1024<=x<=1024 for x in h)
    assert all(-32768<=x<=32767 for x in w)
    a=sum((value+1024)<<(32*i)for i,value in enumerate(h))
    b=sum((w[7-i]+32768)<<(32*i)for i in range(8))
    center=((a*b)&MASK)>>224
    return center-32768*sum(x+1024 for x in h)-1024*sum(w)


def naive(h,w):return sum(x*y for x,y in zip(h,w))
def trunc(value):return value//1024 if value>=0 else -((-value)//1024)


def main():
    rng=random.Random(718032)
    counts={'exhaustive_endpoint_octuples':0,'random_octuples':0,'full128_rows_bias_and_final_Q10_truncation':0}
    for case in itertools.product(itertools.product((-1024,1024),(-32768,32767)),repeat=8):
        h,w=zip(*case);assert packed(h,w)==naive(h,w);counts['exhaustive_endpoint_octuples']+=1
    for _ in range(100000):
        h=[rng.randint(-1024,1024)for _ in range(8)];w=[rng.randint(-32768,32767)for _ in range(8)]
        assert packed(h,w)==naive(h,w);counts['random_octuples']+=1
    for _ in range(1000):
        h=[rng.randint(-1024,1024)for _ in range(128)];w=[rng.randint(-32768,32767)for _ in range(128)]
        bias=rng.randint(-32768,32767)
        actual=sum(packed(h[i:i+8],w[i:i+8])for i in range(0,128,8))+bias*1024
        expected=naive(h,w)+bias*1024
        assert actual==expected and trunc(actual)==trunc(expected)
        counts['full128_rows_bias_and_final_Q10_truncation']+=1
    rejected=0
    for h,w in [([1025]*8,[1]*8),([-1025]*8,[1]*8),([1]*8,[32768]*8),([1]*8,[-32769]*8)]:
        try:packed(h,w)
        except AssertionError:rejected+=1
        else:raise AssertionError('Out-of-bound operand accepted')
    report={'status':'PASS_EXACT_INTEGER_IDENTITY','cases':counts,'invalid_bound_cases_rejected':rejected,
            'bounds':{'h':[-1024,1024],'w':[-32768,32767],'biased_h':[0,2048],'biased_w':[0,65535],
                      'max_polynomial_coefficient':8*2048*65535,'coefficient_less_than_bits':30,'lane_bits':32,
                      'center_start_bit':224,'center_highest_possible_bit':253},
            'proof':['For t=2^32, A=sum_i(h_i+1024)t^i and B=sum_i(w_(7-i)+32768)t^i.',
                     'Every coefficient has at most8 terms and is at most1073725440<2^30<2^32; hence no inter-lane carry.',
                     'Coefficient7 is sum_i(h_i+1024)(w_i+32768). It fits entirely in bits224..253.',
                     'Reduction modulo2^256 discards only coefficients8..14. Shifting right224 extracts coefficient7 exactly.',
                     'Signed subtraction of32768*sum_i(h_i+1024) and1024*sum_i(w_i) leaves sum_i(h_i*w_i).',
                     'Sixteen corrected groups cover128 products. Add Q10-scaled bias and divide once toward zero after complete accumulation.'],
            'requirements':['Enforce both input ranges.','Reverse exactly one packed operand.','Use signed corrections.','Apply Q10 truncation only once after the whole row.'],
            'not_proven':'No EVM bytecode, runtime-load or gas result is inferred from this Python/math proof.',
            'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    p=Path(__file__).with_name('packing8-proof.json');p.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'output':str(p),'status':report['status'],'cases':counts,'bound':report['bounds']['max_polynomial_coefficient']}))


if __name__=='__main__':main()
