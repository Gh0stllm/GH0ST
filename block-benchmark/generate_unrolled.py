"""Generate exact unrolled candidates from the reviewed six-lane kernel."""
from pathlib import Path

ROOT=Path(__file__).resolve().parent
source=(ROOT/'LfmBlockFast6.sol').read_text()
start=source.index('                for { let g := 0 }',source.index('let bpackedSum'))
end=source.index('                sum := sub(add(sum,correction)',start)
for factor in [4,8,16]:
    name=f'LfmBlockFast6U{factor}'
    body='                let g := 0\n'
    body+=f'                for {{ }} lt(add(g,{factor-1}),groups) {{ g := add(g,{factor}) }} {{\n'
    for i in range(factor):
        body+='                    {\n'
        body+=f'                        let q := xor(shr(232,mload(add(wp,add(mul(g,3),{i*3})))),0x888888)\n'
        body+='                        q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))\n'
        body+='                        let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),0xf000000000f000000000f000000000f000000000f000000000f)\n'
        body+='                        bpackedSum := add(bpackedSum,bp)\n'
        body+=f'                        sum := add(sum,and(shr(200,mul(mload(add(ap,add(mul(g,32),{i*32}))),bp)),0xffffffffff))\n'
        body+='                    }\n'
    body+='                }\n'
    body+=source[start:end].replace('for { let g := 0 }','for { }')
    output=(source[:start]+body+source[end:]).replace('LfmBlockFast6',name)
    (ROOT/(name+'.sol')).write_text(output)

source=(ROOT/'LfmBlockWide5.sol').read_text()
start=source.index('                for { let g := 0 }',source.index('let accum'))
end=source.index('                sum := sub(add(and(shr(192,accum)',start)
loop=source[start:end]
inner=loop[loop.index('\n')+1:loop.rindex('                }')]
for factor in [2,4,8]:
    name=f'LfmBlockWide5U{factor}'
    body='                let g := 0\n'
    body+=f'                for {{ }} lt(add(g,{factor-1}),pairs) {{ g := add(g,{factor}) }} {{\n'
    for i in range(factor):
        body+='                    {\n'
        body+=inner.replace('mul(g,5)',f'add(mul(g,5),{i*5})').replace('mul(g,64)',f'add(mul(g,64),{i*64})')
        body+='                    }\n'
    body+='                }\n'+loop.replace('for { let g := 0 }','for { }')
    (ROOT/(name+'.sol')).write_text((source[:start]+body+source[end:]).replace('LfmBlockWide5',name))
