// SPDX-License-Identifier: GPL-3.0-or-later
// Isolated exact-arithmetic test; not linked into any engine canister.
#include <stdint.h>
#include <wasm_simd128.h>
static uint32_t rng(uint32_t& s){s^=s<<13;s^=s>>17;s^=s<<5;return s;}
extern "C" uint32_t test_kernel(uint32_t seed,uint32_t cases){
 static_assert(2*127*127==32258 && 2*127*-128==-32512);
 uint32_t bad=0;
 // All activation pairs against every endpoint weight-pair combination.
 const int8_t endpoints[4]={-128,-127,126,127};
 for(int a=0;a<128;++a)for(int b=0;b<128;++b)
  for(int x=0;x<4;++x)for(int y=0;y<4;++y){int p=a*endpoints[x]+b*endpoints[y];bad+=p < -32768||p>32767;}
 for(uint32_t t=0;t<cases;++t){
  uint8_t input[4];int8_t weights[16];int16_t even[8],odd[8];uint32_t bias[4],got[4];
  for(auto& x:input)x=uint8_t(rng(seed)&127);
  for(auto& x:weights)x=int8_t(rng(seed));
  for(int o=0;o<4;++o){even[o*2]=weights[o*4];even[o*2+1]=weights[o*4+1];odd[o*2]=weights[o*4+2];odd[o*2+1]=weights[o*4+3];bias[o]=rng(seed);}
  const uint32_t raw=uint32_t(input[0])|(uint32_t(input[1])<<8)|(uint32_t(input[2])<<16)|(uint32_t(input[3])<<24);
  const auto ev=wasm_i32x4_splat((raw&255u)|((raw&65280u)<<8));
  const auto od=wasm_i32x4_splat(((raw>>16)&255u)|((raw>>8)&16711680u));
  const auto e=wasm_i32x4_dot_i16x8(ev,wasm_v128_load(even));
  const auto o=wasm_i32x4_dot_i16x8(od,wasm_v128_load(odd));
  wasm_v128_store(got,wasm_i32x4_add(wasm_v128_load(bias),wasm_i32x4_add(e,o)));
  for(int lane=0;lane<4;++lane){
   uint32_t want=bias[lane];for(int i=0;i<4;++i)want+=uint32_t(int(input[i])*int(weights[lane*4+i]));
   bad+=got[lane]!=want;
  }
 }
 return bad;
}
