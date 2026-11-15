"""Derived i16 view of unchanged threat/pawn-pair i8 parameters."""
def patch(source):
    p = source / 'nnue/nnue_feature_transformer.h'
    s = p.read_text()
    anchor = '        permute_weights();\n\n        return !stream.fail();'
    assert s.count(anchor) == 1
    s = s.replace(anchor, '''        permute_weights();
#if defined(__wasm__) && defined(GH0ST_EXPANDED_THREATS)
        for (IndexType i = 0; i < ThreatAndPpWeightSize; ++i)
            wasmThreatAndPpWeights[i] = threatAndPpWeights[i];
#endif

        return !stream.fail();''')
    anchor = '    alignas(CacheLineSize) ThreatAndPpWeightArray threatAndPpWeights;'
    assert s.count(anchor) == 1
    s = s.replace(anchor, anchor + '''
#if defined(__wasm__) && defined(GH0ST_EXPANDED_THREATS)
    // Same permuted lane coordinates, exact signed widening only. The original
    // i8 array remains authoritative for parameter hashing and serialization.
    alignas(CacheLineSize) std::array<i16, ThreatAndPpWeightSize> wasmThreatAndPpWeights;
#endif''')
    p.write_text(s)
    p = source / 'nnue/nnue_accumulator.cpp'
    s = p.read_text()
    anchor = '''        auto* column =
          reinterpret_cast<const vec_i8_t*>(&ft.threatAndPpWeights[list[i] * Dimensions + j]);
    #ifdef USE_NEON'''
    assert s.count(anchor) == 1
    s = s.replace(anchor, '''#if defined(__wasm__) && defined(GH0ST_EXPANDED_THREATS)
        const auto* column = reinterpret_cast<const vec_t*>(
          &ft.wasmThreatAndPpWeights[list[i] * Dimensions + j]);
        for (IndexType k = 0; k < Tiling::NumRegs; ++k)
            if constexpr (sign == +1)
                acc[k] = vec_add_16(acc[k], column[k]);
            else
                acc[k] = vec_sub_16(acc[k], column[k]);
#else
        auto* column =
          reinterpret_cast<const vec_i8_t*>(&ft.threatAndPpWeights[list[i] * Dimensions + j]);
    #ifdef USE_NEON''')
    anchor = '''                acc[k] = vec_sub_16(acc[k], vec_convert_8_16(column[k]));
    #endif
    }'''
    assert s.count(anchor) == 1
    s = s.replace(anchor, '''                acc[k] = vec_sub_16(acc[k], vec_convert_8_16(column[k]));
    #endif
#endif
    }''')
    p.write_text(s)
