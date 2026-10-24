#!/usr/bin/env python3
"""Prove/test four signed Q10 products packed into unsigned64-bit lanes."""
import hashlib
import itertools
import json
import random
from pathlib import Path

MASK = (1 << 256)-1


def packed(h, w):
    assert len(h) == len(w) == 4
    assert all(-1024 <= x <= 1024 for x in h)
    assert all(-32768 <= x <= 32767 for x in w)
    a = sum((x+1024) << (64*i) for i, x in enumerate(h))
    b = sum((w[3-i]+32768) << (64*i) for i in range(4))
    central = ((a*b) & MASK) >> 192
    return central-32768*sum(x+1024 for x in h)-1024*sum(w)


def naive(h, w):
    return sum(a*b for a,b in zip(h,w))


def trunc_q10(value):
    return value//1024 if value >= 0 else -((-value)//1024)


def main():
    rng = random.Random(717031)
    edge_values = list(itertools.product((-1024,1024), (-32768,32767)))
    counts = {'exhaustive_endpoint_quadruples':0, 'random_quadruples':0,
              'full128_rows_with_bias_and_Q10_truncation':0}
    for case in itertools.product(edge_values, repeat=4):
        h,w = zip(*case)
        assert packed(h,w) == naive(h,w)
        counts['exhaustive_endpoint_quadruples'] += 1
    for _ in range(100000):
        h = [rng.randint(-1024,1024) for _ in range(4)]
        w = [rng.randint(-32768,32767) for _ in range(4)]
        assert packed(h,w) == naive(h,w)
        counts['random_quadruples'] += 1
    row_examples = []
    for row in range(1000):
        h = [rng.randint(-1024,1024) for _ in range(128)]
        w = [rng.randint(-32768,32767) for _ in range(128)]
        bias = rng.randint(-32768,32767)
        actual = sum(packed(h[i:i+4],w[i:i+4]) for i in range(0,128,4))+bias*1024
        expected = naive(h,w)+bias*1024
        assert actual == expected and trunc_q10(actual) == trunc_q10(expected)
        counts['full128_rows_with_bias_and_Q10_truncation'] += 1
        if row < 3: row_examples.append({'accumulator':actual,'q10':trunc_q10(actual)})
    rejected = 0
    for h,w in [([1025]*4,[1]*4),([-1025]*4,[1]*4),([1]*4,[32768]*4),([1]*4,[-32769]*4)]:
        try: packed(h,w)
        except AssertionError: rejected += 1
        else: raise AssertionError('Invalid input accepted')
    report = {'status':'PASS_EXACT_INTEGER_IDENTITY','cases':counts,'invalid_bound_cases_rejected':rejected,
              'bounds':{'x_h_plus1024':[0,2048],'y_w_plus32768':[0,65535],
                        'max_polynomial_coefficient':4*2048*65535,
                        'coefficient_less_than_bits':29,'lane_bits':64,
                        'max_abs128_dot_before_bias':128*1024*32768,
                        'max_abs128_accumulator_with_bias':128*1024*32768+32768*1024},
              'proof':[
                  'A(t)=sum_i(h_i+1024)t^i; B(t)=sum_i(w_(3-i)+32768)t^i, t=2^64.',
                  'Every coefficient has at most4 nonnegative terms and is at most536862720<2^29<2^64, hence no base-2^64 carry.',
                  'Coefficient3 equals sum_i(h_i+1024)(w_i+32768).',
                  'Taking product mod2^256 discards only coefficients4..6; shifting right192 returns coefficient3 exactly.',
                  'Subtract32768*sum_i(h_i+1024) and1024*sum_i(w_i), in signed arithmetic, leaving sum_i(h_i*w_i).',
                  'Summing32 corrected quadruples gives an exact128-term dot product. Add bias*1024 and truncate once toward zero to preserve Q10 semantics.'
              ],
              'requirements':['Both packed operand vectors must satisfy the recorded ranges.','Use signed accumulator/corrections; checked unsigned subtraction can revert for negative products.','Do not truncate each quadruple independently; accumulate all products before the one prescribed Q10 division.','Packing implementation must reverse exactly one operand and preserve signed decoding before bias addition.'],
              'not_proven':'This is mathematical/Python evidence, not a Solidity assembly implementation proof or gas benchmark.',
              'row_examples':row_examples,'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    out=Path(__file__).with_name('packing-proof.json')
    out.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'output':str(out),'status':report['status'],'cases':counts,'coefficient_bound':report['bounds']['max_polynomial_coefficient']}))


if __name__=='__main__':main()
