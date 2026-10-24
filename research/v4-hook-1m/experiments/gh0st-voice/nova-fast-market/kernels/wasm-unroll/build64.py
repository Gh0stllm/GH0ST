from pathlib import Path
P=Path(__file__).parent;S=P.parent.parent/'stylus/wasm-packed3';base=(S/'src/lib.rs').read_text()
old=' let mut sum=0i64;for i in 0..128{let w=i64::from_le(core::ptr::read_unaligned(weights.add(i*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(i)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}sum'
assert old in base
for n in [64]:
 out=P/str(n);(out/'src').mkdir(parents=True,exist_ok=True)
 def term(index):return f'{{let w=i64::from_le(core::ptr::read_unaligned(weights.add(({index})*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add({index})).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}}'
 if n==128:body=' let mut sum=0i64;\n'+'\n'.join(term(str(i))for i in range(128))+'\n sum'
 else:body=' let mut sum=0i64;let mut i=0;while i<128 {\n'+'\n'.join(term(f'i+{j}')for j in range(n))+f'\n i+={n};}}\n sum'
 (out/'src/lib.rs').write_text(base.replace(old,body))
 (out/'Cargo.toml').write_text((S/'Cargo.toml').read_text().replace('nova-wasm-packed3',f'nova-wasm-unroll{n}'))
print('Generated8/16/32/128 exact unrolls')
