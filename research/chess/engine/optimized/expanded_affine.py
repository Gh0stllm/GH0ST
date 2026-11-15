"""Exact derived i16 packing for the small sparse affine matrix, not feature weights."""
def patch(source):
 p=source/'nnue/layers/affine_transform_sparse_input.h';s=p.read_text()
 anchor='''        return !stream.fail();
    }

    // Write network parameters'''
 derived='''#if defined(__wasm__) && defined(GH0ST_EXPANDED_AFFINE)
        // Derived from the unchanged signed i8 parameters; wire/hash/save use i8.
        for (IndexType c=0;c<PaddedInputDimensions/4;++c)
            for (IndexType b=0;b<OutputDimensions/4;++b)
                for (IndexType o=0;o<4;++o)
                {
                    const auto from=c*OutputDimensions*4+(b*4+o)*4;
                    const auto to=c*OutputDimensions*2+b*8+o*2;
                    wasm_even[to]=weights[from];wasm_even[to+1]=weights[from+1];
                    wasm_odd[to]=weights[from+2];wasm_odd[to+1]=weights[from+3];
                }
#endif
        return !stream.fail();
    }

    // Write network parameters'''
 assert s.count(anchor)==1;s=s.replace(anchor,derived)
 anchor='''#if (defined(USE_SSSE3) || defined(USE_LSX) || defined(USE_LASX) || (USE_NEON >= 8))
    #if defined(USE_AVX512)'''
 fast='''#if defined(__wasm__) && defined(GH0ST_EXPANDED_AFFINE)
        // Feature transformer output is 0..127. Thus signed i8 products and
        // i16 pair sums exactly match maddubs (its saturation is unreachable).
        // Keep every active input chunk in upstream order and every i32 sum.
        constexpr auto Blocks=OutputDimensions/4;
        v128_t acc[Blocks];
        for(IndexType b=0;b<Blocks;++b)acc[b]=wasm_v128_load(biases+b*4);
        for(IndexType k=0;k<InputDimensions/256;++k)
        {
            u64 bits=load_as<u64>(nnzInfo.bitset+k*8);
            while(bits)
            {
                const IndexType c=k*64+pop_lsb(bits);
                const u32 raw=load_as<u32>(input+c*4);
                const auto ev=wasm_i32x4_splat((raw&255u)|((raw&65280u)<<8));
                const auto od=wasm_i32x4_splat(((raw>>16)&255u)|((raw>>8)&16711680u));
                const auto* ew=wasm_even+c*OutputDimensions*2;
                const auto* ow=wasm_odd+c*OutputDimensions*2;
                for(IndexType b=0;b<Blocks;++b)
                {
                    const auto e=wasm_i32x4_dot_i16x8(ev,wasm_v128_load(ew+b*8));
                    const auto o=wasm_i32x4_dot_i16x8(od,wasm_v128_load(ow+b*8));
                    acc[b]=wasm_i32x4_add(acc[b],wasm_i32x4_add(e,o));
                }
            }
        }
        for(IndexType b=0;b<Blocks;++b)wasm_v128_store(output+b*4,acc[b]);
#elif (defined(USE_SSSE3) || defined(USE_LSX) || defined(USE_LASX) || (USE_NEON >= 8))
    #if defined(USE_AVX512)'''
 assert s.count(anchor)==1;s=s.replace(anchor,fast)
 anchor='''    alignas(CacheLineSize) WeightType weights[OutputDimensions * PaddedInputDimensions];'''
 more=anchor+'''
#if defined(__wasm__) && defined(GH0ST_EXPANDED_AFFINE)
    alignas(CacheLineSize) i16 wasm_even[OutputDimensions*PaddedInputDimensions/2];
    alignas(CacheLineSize) i16 wasm_odd[OutputDimensions*PaddedInputDimensions/2];
#endif'''
 assert s.count(anchor)==1;s=s.replace(anchor,more)
 p.write_text(s)
