// Ordinary Stylus ABI adapter around the byte-identical existing runtime source.
// All arithmetic and complete model geometry remain in pinned_runtime.cpp.
#include "pinned_runtime.cpp"
#include "page_manifest.h"

#define HOOK(name) __attribute__((import_module("vm_hooks"), import_name(name)))
extern "C" {
HOOK("read_args") void read_args(uint8_t*);
HOOK("write_result") void write_result(const uint8_t*,uint32_t);
HOOK("storage_load_bytes32") void storage_load_bytes32(const uint8_t*,uint8_t*);
HOOK("storage_cache_bytes32") void storage_cache_bytes32(const uint8_t*,const uint8_t*);
HOOK("storage_flush_cache") void storage_flush_cache(uint32_t);
HOOK("account_code") uint32_t account_code(const uint8_t*,uint32_t,uint32_t,uint8_t*);
HOOK("account_code_size") uint32_t account_code_size(const uint8_t*);
HOOK("msg_sender") void msg_sender(uint8_t*);
HOOK("pay_for_memory_grow") void pay_for_memory_grow(uint32_t);
}
namespace {
uint8_t args[4+96+64*32];
constexpr uint32_t LOGIT_BYTES=50257*4;
uint32_t fail(const char* reason){uint32_t n=0;while(reason[n])++n;write_result(reinterpret_cast<const uint8_t*>(reason),n);return 1;}
void word(uint8_t* out,uint64_t n){std::memset(out,0,32);for(int i=0;i<8;++i)out[31-i]=uint8_t(n>>(i*8));}
bool number(const uint8_t* in,uint64_t& n){for(int i=0;i<24;++i)if(in[i])return false;n=0;for(int i=24;i<32;++i)n=(n<<8)|in[i];return true;}
void page_key(uint32_t i,uint8_t out[32]){std::memset(out,0,32);std::memcpy(out,"GH0ST-MODEL-PAGE",16);out[28]=uint8_t(i>>24);out[29]=uint8_t(i>>16);out[30]=uint8_t(i>>8);out[31]=uint8_t(i);}
void result_key(const uint8_t caller[20],uint8_t field,uint8_t out[32]){uint8_t in[85];std::memcpy(in,EXPECTED_MODEL_SHA256,32);std::memcpy(in+32,ARITHMETIC_ID,32);std::memcpy(in+64,caller,20);in[84]=field;sha256(in,sizeof(in),out);}
void load_result(const uint8_t caller[20],uint8_t field,uint8_t out[32]){uint8_t key[32];result_key(caller,field,key);storage_load_bytes32(key,out);}
void store_result(const uint8_t caller[20],uint8_t field,const uint8_t value[32]){uint8_t key[32];result_key(caller,field,key);storage_cache_bytes32(key,value);}
bool load_model(){
    for(uint32_t i=0;i<PAGE_COUNT;++i){uint8_t key[32],address[32];page_key(i,key);storage_load_bytes32(key,address);
        uint32_t n=(i+1==PAGE_COUNT)?MODEL_BYTES-i*PAGE_BYTES:PAGE_BYTES;
        if(account_code_size(address+12)!=n+1||account_code(address+12,1,n,model+i*PAGE_BYTES)!=n)return false;
    }
    // Hash every loaded byte inside Wasm. No caller digest/preverified shortcut.
    return gh_seal_model()==0;
}
}
extern "C" uint32_t user_entrypoint(uint32_t len){
    // Required standard Stylus import, instrumented for actual memory.grow.
    pay_for_memory_grow(0);
    if(len<4||len>sizeof(args))return fail("calldata size");
    read_args(args);
    uint32_t selector=(uint32_t(args[0])<<24)|(uint32_t(args[1])<<16)|(uint32_t(args[2])<<8)|args[3];
    if(selector==SELECTOR_MODEL_INFO){
        if(len!=4)return fail("modelInfo calldata");
        std::memcpy(checkpoint,EXPECTED_MODEL_SHA256,32);word(checkpoint+32,3745984);word(checkpoint+64,MODEL_BYTES);word(checkpoint+96,64);word(checkpoint+128,50257);word(checkpoint+160,8);std::memcpy(checkpoint+192,ARITHMETIC_ID,32);write_result(checkpoint,224);return 0;
    }
    if(selector==SELECTOR_REGISTER_PAGE){
        uint64_t index;
        if(len!=68||!number(args+4,index)||index>=PAGE_COUNT)return fail("page index");
        for(int i=0;i<12;++i)if(args[36+i])return fail("page address");
        uint32_t n=(index+1==PAGE_COUNT)?MODEL_BYTES-index*PAGE_BYTES:PAGE_BYTES;uint8_t prefix;
        if(account_code_size(args+48)!=n+1||account_code(args+48,0,1,&prefix)!=1||prefix!=0||account_code(args+48,1,n,model)!=n)return fail("page code");
        uint8_t digest[32];sha256(model,n,digest);if(std::memcmp(digest,PAGE_SHA256[index],32))return fail("page hash");
        uint8_t key[32],old[32];page_key(uint32_t(index),key);storage_load_bytes32(key,old);
        bool empty=true;for(uint8_t b:old)if(b)empty=false;
        if(!empty&&std::memcmp(old,args+36,32))return fail("page immutable");
        storage_cache_bytes32(key,args+36);storage_flush_cache(0);write_result(checkpoint,0);return 0;
    }
    if(selector==SELECTOR_RESULT){
        if(len!=36)return fail("result calldata");for(int i=0;i<12;++i)if(args[4+i])return fail("result address");
        for(uint8_t field=0;field<5;++field)load_result(args+16,field,checkpoint+field*32);
        write_result(checkpoint,160);return 0;
    }
    if(selector!=SELECTOR_INFER)return fail("unknown selector");
    uint64_t nonce,offset,count;
    if(len<100||!number(args+4,nonce)||nonce==UINT64_MAX||!number(args+36,offset)||offset!=64||!number(args+68,count)||count<1||count>64||len!=100+count*32)return fail("infer calldata");
    for(uint32_t i=0;i<count;++i){uint64_t token;if(!number(args+100+i*32,token)||token>=50257)return fail("prompt token");}
    uint8_t caller[20],stored[32];msg_sender(caller);load_result(caller,0,stored);uint64_t current;
    if(!number(stored,current)||current!=nonce)return fail("nonce");
    if(!load_model()||gh_reset()!=0)return fail("model authentication");
    for(uint32_t i=0;i<count;++i){uint64_t token;number(args+100+i*32,token);if(gh_begin(uint32_t(token)))return fail("begin");
        while(gh_phase()!=11)if(gh_advance(gh_step(),512))return fail("numeric execution");
    }
    uint8_t logits_hash[32],state_hash[32],prompt_hash[32],value[32];
    sha256(reinterpret_cast<const uint8_t*>(state.logits),LOGIT_BYTES,logits_hash);
    uint32_t state_bytes=gh_checkpoint_export();sha256(checkpoint,state_bytes,state_hash);
    sha256(args+68,32+count*32,prompt_hash);
    word(value,nonce+1);store_result(caller,0,value);word(value,gh_best_token());store_result(caller,1,value);store_result(caller,2,logits_hash);store_result(caller,3,state_hash);store_result(caller,4,prompt_hash);storage_flush_cache(0);
    // Solidity ABI tuple (uint32,bytes32,bytes32,bytes), packed little-endian logits.
    word(checkpoint,gh_best_token());std::memcpy(checkpoint+32,logits_hash,32);std::memcpy(checkpoint+64,state_hash,32);word(checkpoint+96,128);word(checkpoint+128,LOGIT_BYTES);
    std::memcpy(checkpoint+160,state.logits,LOGIT_BYTES);uint32_t output=160+((LOGIT_BYTES+31)/32)*32;std::memset(checkpoint+160+LOGIT_BYTES,0,output-160-LOGIT_BYTES);write_result(checkpoint,output);return 0;
}
