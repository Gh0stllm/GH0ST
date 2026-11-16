// Full fixed-point TinyStories/GPT-Neo reference runtime for a future custom STF.
// No filesystem, clock, randomness, threads, sockets, external inference or SIMD.
// This raw native/Wasm module is NOT an activated Stylus or Nitro precompile.
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <climits>
#include <initializer_list>
#include "model_layout.h"

namespace {
constexpr int64_t Q=4096, SCALE=16777216;
constexpr uint32_t WIDTH=64,VOCAB=50257,CONTEXT=64;
uint8_t model[MODEL_BYTES];
bool sealed=false;
bool arithmetic_ok=true;
int64_t add(int64_t a,int64_t b){int64_t r;if(__builtin_add_overflow(a,b,&r)){arithmetic_ok=false;return 0;}return r;}
int64_t sub(int64_t a,int64_t b){int64_t r;if(__builtin_sub_overflow(a,b,&r)){arithmetic_ok=false;return 0;}return r;}
int64_t mul(int64_t a,int64_t b){int64_t r;if(__builtin_mul_overflow(a,b,&r)){arithmetic_ok=false;return 0;}return r;}
struct State {
    uint32_t phase, layer, head, cursor, pos, token, step, best;
    int64_t best_logit;
    int64_t x[64], n[64], qkv[192], attention[64], fc[256];
    int64_t keys[8][64][64], values[8][64][64];
    int32_t logits[VOCAB];
} state, staging;
uint8_t checkpoint[sizeof(State)+256];
constexpr uint32_t CHECKPOINT_BYTES=4+4+32+8*4+8+(64+64+192+64+256+2*8*64*64)*8+VOCAB*4;

uint32_t rotr(uint32_t x,uint32_t n){return (x>>n)|(x<<(32-n));}
void sha256(const uint8_t* data,size_t len,uint8_t out[32]) {
    static const uint32_t k[64]={0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
    uint32_t h[8]={0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
    size_t blocks=(len+9+63)/64;
    for(size_t b=0;b<blocks;++b){
        uint8_t chunk[64]={};uint32_t w[64];
        for(size_t i=0;i<64;++i){size_t at=b*64+i;if(at<len)chunk[i]=data[at];else if(at==len)chunk[i]=0x80;}
        if(b+1==blocks){uint64_t bits=uint64_t(len)*8;for(int i=0;i<8;++i)chunk[63-i]=uint8_t(bits>>(8*i));}
        for(int i=0;i<16;++i)w[i]=(uint32_t(chunk[i*4])<<24)|(uint32_t(chunk[i*4+1])<<16)|(uint32_t(chunk[i*4+2])<<8)|chunk[i*4+3];
        for(int i=16;i<64;++i){uint32_t a=w[i-15],z=w[i-2];w[i]=w[i-16]+(rotr(a,7)^rotr(a,18)^(a>>3))+w[i-7]+(rotr(z,17)^rotr(z,19)^(z>>10));}
        uint32_t a=h[0],c=h[2],b0=h[1],d=h[3],e=h[4],f=h[5],g=h[6],z=h[7];
        for(int i=0;i<64;++i){uint32_t t=z+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^((~e)&g))+k[i]+w[i];uint32_t t2=(rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b0)^(a&c)^(b0&c));z=g;g=f;f=e;e=d+t;d=c;c=b0;b0=a;a=t+t2;}
        h[0]+=a;h[1]+=b0;h[2]+=c;h[3]+=d;h[4]+=e;h[5]+=f;h[6]+=g;h[7]+=z;
    }
    for(int i=0;i<8;++i)for(int j=0;j<4;++j)out[i*4+j]=uint8_t(h[i]>>(24-8*j));
}
uint32_t u32be(const uint8_t* p){return (uint32_t(p[0])<<24)|(uint32_t(p[1])<<16)|(uint32_t(p[2])<<8)|p[3];}
int32_t i32be(const uint8_t* p){return int32_t(u32be(p));}
uint64_t isqrt(uint64_t n){uint64_t r=0,bit=uint64_t(1)<<62;while(bit>n)bit>>=2;while(bit){if(n>=r+bit){n-=r+bit;r=(r>>1)+bit;}else r>>=1;bit>>=2;}return r;}
bool i32(int64_t x){return x>=INT32_MIN&&x<=INT32_MAX;}
void norm(const int64_t* x,int64_t* y,uint32_t tensor){
    const uint8_t* p=model+OFFSETS[tensor];int64_t sum=0;for(int i=0;i<64;++i)sum=add(sum,x[i]);int64_t mean=sum/64,variance=0;
    for(int i=0;i<64;++i){int64_t v=sub(x[i],mean);variance=add(variance,mul(v,v));}uint64_t denom=isqrt(uint64_t(variance/64+168));
    if(!arithmetic_ok||denom==0){arithmetic_ok=false;return;}
    for(int i=0;i<64;++i){y[i]=add(mul(mul(sub(x[i],mean),Q)/int64_t(denom),i32be(p+i*4))/Q,i32be(p+256+i*4));if(!i32(y[i]))arithmetic_ok=false;}
}
int64_t linear(const int64_t* x,uint32_t tensor,uint32_t row,uint32_t width){
    const uint8_t* p=model+OFFSETS[tensor]+row*(width+8);int64_t sum=0;for(uint32_t i=0;i<width;++i)sum=add(sum,mul(int8_t(p[8+i]),x[i]));
    int64_t out=add(mul(sum,int64_t(u32be(p+4)))/SCALE,i32be(p));if(!i32(out))arithmetic_ok=false;return out;
}
int64_t gelu(int64_t x){int64_t x2=mul(x,x)/Q,x3=mul(x2,x)/Q,inner=mul(add(x,mul(x3,183)/Q),3268)/Q;if(inner==INT64_MIN){arithmetic_ok=false;return 0;}uint64_t a=inner<0?uint64_t(-inner):uint64_t(inner);uint64_t index=a/16;int64_t t=Q;
    if(index<2048){const uint8_t* p=model+OFFSETS[52]+index*2;t=(uint32_t(p[0])<<8)|p[1];}if(inner<0)t=-t;return mul(x,Q+t)/(2*Q);
}
void put32(uint8_t*&p,uint32_t v){for(int i=0;i<4;++i)*p++=uint8_t(v>>(i*8));}
void put64(uint8_t*&p,uint64_t v){for(int i=0;i<8;++i)*p++=uint8_t(v>>(i*8));}
uint32_t get32(const uint8_t*&p){uint32_t v=0;for(int i=0;i<4;++i)v|=uint32_t(*p++)<<(i*8);return v;}
uint64_t get64(const uint8_t*&p){uint64_t v=0;for(int i=0;i<8;++i)v|=uint64_t(*p++)<<(i*8);return v;}
// Serialization lists each field explicitly and is identical across CPU/Wasm ABIs.
size_t dump(uint8_t* out){uint8_t* p=out;put32(p,0x31564d47);put32(p,1);std::memcpy(p,EXPECTED_MODEL_SHA256,32);p+=32;
    for(uint32_t v:{state.phase,state.layer,state.head,state.cursor,state.pos,state.token,state.step,state.best})put32(p,v);
    put64(p,uint64_t(state.best_logit));
    auto vec=[&](const int64_t* a,size_t n){for(size_t i=0;i<n;++i)put64(p,uint64_t(a[i]));};
    vec(state.x,64);vec(state.n,64);vec(state.qkv,192);vec(state.attention,64);vec(state.fc,256);
    vec(&state.keys[0][0][0],8*64*64);vec(&state.values[0][0][0],8*64*64);
    for(int32_t v:state.logits)put32(p,uint32_t(v));return size_t(p-out);
}
}
extern "C" {
uintptr_t gh_model_ptr(){return reinterpret_cast<uintptr_t>(model);}
uint32_t gh_model_len(){return MODEL_BYTES;}
int32_t gh_seal_model(){uint8_t digest[32];sha256(model,MODEL_BYTES,digest);sealed=std::memcmp(digest,EXPECTED_MODEL_SHA256,32)==0;return sealed?0:-1;}
int32_t gh_reset(){if(!sealed)return -1;std::memset(&state,0,sizeof(state));state.best_logit=INT64_MIN;return 0;}
int32_t gh_begin(uint32_t token){if(!sealed||token>=VOCAB||(state.phase!=0&&state.phase!=11))return -1;if(state.phase==11){if(state.pos+1>=CONTEXT)return -2;++state.pos;}
    state.phase=1;state.layer=0;state.head=0;state.cursor=0;state.token=token;state.best=0;state.best_logit=INT64_MIN;return 0;}
int32_t gh_advance(uint32_t expected_step,uint32_t rows){
    if(!sealed||expected_step!=state.step||rows==0||rows>512||state.phase==0||state.phase==11)return -1;
    uint32_t first=3+state.layer*6,phase=state.phase;arithmetic_ok=true;
    if(phase==1){const uint8_t* e=model+OFFSETS[0]+state.token*68;int64_t scale=u32be(e);for(int i=0;i<64;++i)state.x[i]=int8_t(e[4+i])*scale/Q+i32be(model+OFFSETS[1]+(state.pos*64+i)*4);state.phase=2;}
    else if(phase==2){norm(state.x,state.n,first);state.phase=3;state.cursor=0;}
    else if(phase==3){uint32_t end=state.cursor+rows;if(end>192)end=192;for(uint32_t i=state.cursor;i<end;++i)state.qkv[i]=linear(state.n,first+2,i,64);state.cursor=end;
        if(end==192){for(int i=0;i<64;++i){state.keys[state.layer][state.pos][i]=state.qkv[64+i];state.values[state.layer][state.pos][i]=state.qkv[128+i];}state.phase=4;state.head=0;state.cursor=0;}}
    else if(phase==4){int64_t scores[64],maximum=INT64_MIN;uint32_t head=state.head;for(uint32_t t=0;t<=state.pos;++t){int64_t s=0;for(int j=0;j<4;++j)s=add(s,mul(state.keys[state.layer][t][head*4+j],state.qkv[head*4+j]));scores[t]=s/Q;if(scores[t]>maximum)maximum=scores[t];}
        int64_t weighted[4]={},denom=0;for(uint32_t t=0;t<=state.pos;++t){uint64_t diff=uint64_t(sub(maximum,scores[t]));uint32_t exponent=diff>65536?0:u32be(model+OFFSETS[51]+(diff/16)*4);denom+=exponent;for(int j=0;j<4;++j)weighted[j]=add(weighted[j],mul(int64_t(exponent),state.values[state.layer][t][head*4+j]));}
        if(denom<=0)return -3;for(int j=0;j<4;++j)state.attention[head*4+j]=weighted[j]/denom;if(++state.head==16){state.phase=5;state.cursor=0;}}
    else if(phase==5){uint32_t end=state.cursor+rows;if(end>64)end=64;for(uint32_t i=state.cursor;i<end;++i)state.x[i]=add(state.x[i],linear(state.attention,first+3,i,64));state.cursor=end;if(end==64){state.phase=6;state.cursor=0;}}
    else if(phase==6){norm(state.x,state.n,first+1);state.phase=7;state.cursor=0;}
    else if(phase==7){uint32_t end=state.cursor+rows;if(end>256)end=256;for(uint32_t i=state.cursor;i<end;++i)state.fc[i]=gelu(linear(state.n,first+4,i,64));state.cursor=end;if(end==256){state.phase=8;state.cursor=0;}}
    else if(phase==8){uint32_t end=state.cursor+rows;if(end>64)end=64;for(uint32_t i=state.cursor;i<end;++i)state.x[i]=add(state.x[i],linear(state.fc,first+5,i,256));state.cursor=end;if(end==64){state.cursor=0;state.phase=(++state.layer==8)?9:2;}}
    else if(phase==9){norm(state.x,state.n,2);state.phase=10;state.cursor=0;}
    else if(phase==10){uint32_t end=state.cursor+rows;if(end>VOCAB)end=VOCAB;for(uint32_t row=state.cursor;row<end;++row){const uint8_t* p=model+OFFSETS[0]+row*68;int64_t sum=0;for(int i=0;i<64;++i)sum=add(sum,mul(int8_t(p[4+i]),state.n[i]));int64_t logit=mul(sum,int64_t(u32be(p)))/SCALE;if(!i32(logit)){arithmetic_ok=false;break;}state.logits[row]=int32_t(logit);if(logit>state.best_logit){state.best_logit=logit;state.best=row;}}state.cursor=end;if(end==VOCAB)state.phase=11;}
    else return -5;
    if(!arithmetic_ok){state.phase=12;return -6;}
    ++state.step;return 0;
}
uint32_t gh_phase(){return state.phase;}uint32_t gh_step(){return state.step;}uint32_t gh_position(){return state.pos;}uint32_t gh_best_token(){return state.best;}
uintptr_t gh_logits_ptr(){return reinterpret_cast<uintptr_t>(state.logits);}uint32_t gh_logits_count(){return VOCAB;}
uintptr_t gh_checkpoint_ptr(){return reinterpret_cast<uintptr_t>(checkpoint);}uint32_t gh_checkpoint_capacity(){return sizeof(checkpoint);}
uint32_t gh_checkpoint_export(){return uint32_t(dump(checkpoint));}
// expectedSHA256 must come from the committed chain state, NOT user input.
// This integrity primitive does not itself implement an on-chain authority check.
int32_t gh_checkpoint_restore(uint32_t len,const uint8_t* expectedSHA256){
    if(!sealed||len!=CHECKPOINT_BYTES)return -1;
    uint8_t actual[32];sha256(checkpoint,len,actual);if(std::memcmp(actual,expectedSHA256,32))return -2;
    const uint8_t* p=checkpoint;
    if(get32(p)!=0x31564d47||get32(p)!=1||std::memcmp(p,EXPECTED_MODEL_SHA256,32))return -3;p+=32;
    staging.phase=get32(p);staging.layer=get32(p);staging.head=get32(p);staging.cursor=get32(p);
    staging.pos=get32(p);staging.token=get32(p);staging.step=get32(p);staging.best=get32(p);
    staging.best_logit=int64_t(get64(p));
    if(staging.phase>11||staging.layer>8||staging.head>16||staging.cursor>VOCAB||staging.pos>=CONTEXT||staging.token>=VOCAB||staging.best>=VOCAB)return -4;
    if((staging.phase>=2&&staging.phase<=8&&staging.layer>=8)||(staging.phase>=9&&staging.layer!=8))return -4;
    if(staging.phase==4&&(staging.head>=16||staging.cursor!=0))return -4;
    if(staging.phase==1&&(staging.layer!=0||staging.head!=0||staging.cursor!=0))return -4;
    if((staging.phase==3&&staging.cursor>192)||((staging.phase==5||staging.phase==8)&&staging.cursor>64)||(staging.phase==7&&staging.cursor>256))return -4;
    auto vec=[&](int64_t* a,size_t n){for(size_t i=0;i<n;++i)a[i]=int64_t(get64(p));};
    vec(staging.x,64);vec(staging.n,64);vec(staging.qkv,192);vec(staging.attention,64);vec(staging.fc,256);
    vec(&staging.keys[0][0][0],8*64*64);vec(&staging.values[0][0][0],8*64*64);
    for(int32_t&v:staging.logits)v=int32_t(get32(p));
    if(size_t(p-checkpoint)!=len)return -5;
    std::memcpy(&state,&staging,sizeof(State));return 0;
}
}
