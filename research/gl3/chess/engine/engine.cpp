// SPDX-License-Identifier: GPL-3.0-or-later
#include <cstdlib>
#include <cstring>
#include <sstream>
#include "attacks.h"
#include "checkpoint.h"
#include "tune.h"
using namespace Stockfish;
using Bytes=CheckpointAccess::Bytes;
static constexpr size_t MaxState=192*1024*1024;
static void option(Engine& e,const char* name,const char* value){std::istringstream s(std::string("name ")+name+" value "+value);e.get_options().setoption(s);}
static void initialize(Engine& e){
 Tune::init(e.get_options());e.get_options().add_info_listener([](std::optional<std::string>){});
 for(auto [n,v]:std::vector<std::pair<const char*,const char*>>{{"NumaPolicy","none"},{"Threads","1"},{"Hash","128"},{"Skill Level","20"},{"UCI_LimitStrength","false"},{"MultiPV","1"},{"Ponder","false"},{"SyzygyPath",""}})option(e,n,v);
 e.set_on_verify_network([](std::string_view){});e.set_on_update_no_moves([](const Engine::InfoShort&){});e.set_on_iter([](const Engine::InfoIter&){});e.set_on_start([]{});e.search_clear();
}
static Bytes run(const unsigned char* input,size_t size){
 Bytes empty;if(size<16||size>MaxState+16384)return empty;
 auto u32=[&](size_t at){uint32_t x;std::memcpy(&x,input+at,4);return x;};
 uint32_t op=u32(0),nf=u32(4),nm=u32(8),ns=u32(12);
 if(op>1||nf>128||nm>8192||ns>MaxState||size!=16ull+nf+nm+ns||(op==0&&(nm||ns)))return empty;
 std::string fen(reinterpret_cast<const char*>(input+16),nf),moves(reinterpret_cast<const char*>(input+16+nf),nm);
 if(fen.find('\0')!=std::string::npos||moves.find('\0')!=std::string::npos)return empty;
 std::vector<std::string> history;std::istringstream h(moves);for(std::string move;h>>move;){if(move.size()<4||move.size()>5||history.size()>=1024)return empty;history.push_back(move);}
 Attacks::init();Position::init();Engine e;initialize(e);
 if(op==1){Bytes state(input+16+nf+nm,input+size);if(!CheckpointAccess::restore(e,state))return empty;}
 if(e.set_position(fen,history))return empty;
 std::string best;uint64_t nodes=0;uint32_t depth=0;
 if(op==1){
  e.set_on_bestmove([&](std::string_view move,std::string_view){best=move;});
  e.set_on_update_full([&](const Engine::InfoFull& info){nodes=info.nodes;depth=info.depth;});
  Search::LimitsType limits;limits.nodes=24000000;limits.startTime=0;e.go(limits);e.wait_for_search_finished();
  e.set_on_bestmove([](std::string_view,std::string_view){});e.set_on_update_full([](const Engine::InfoFull&){});
  if(best.size()<4||best.size()>5||(nodes<24000000&&depth!=245))return empty;
 }
 auto state=CheckpointAccess::capture(e);Bytes out;out.reserve(24+best.size()+state.size());
 CheckpointAccess::put(out,uint32_t(0));CheckpointAccess::put(out,nodes);CheckpointAccess::put(out,depth);CheckpointAccess::put(out,uint32_t(best.size()));CheckpointAccess::put(out,uint32_t(state.size()));
 out.insert(out.end(),best.begin(),best.end());out.insert(out.end(),state.begin(),state.end());return out;
}
extern "C" uint32_t gl3_execute(const unsigned char* input,uint32_t size,unsigned char** output){
 auto result=run(input,size);if(result.empty())return 0;*output=static_cast<unsigned char*>(std::malloc(result.size()));if(!*output)return 0;std::memcpy(*output,result.data(),result.size());return uint32_t(result.size());
}
extern "C" void gl3_free(void* p){std::free(p);}
extern "C" void* gl3_alloc(uint32_t n){return n<=MaxState+16384?std::malloc(n):nullptr;}
#if defined(__wasm__)
extern "C" void __wasm_call_ctors();
extern "C" __attribute__((import_module("env"),import_name("wavm_caller_load32"))) uint32_t caller_load32(uint32_t);
extern "C" __attribute__((import_module("env"),import_name("wavm_caller_load8"))) uint32_t caller_load8(uint32_t);
extern "C" __attribute__((import_module("env"),import_name("wavm_caller_store32"))) void caller_store32(uint32_t,uint32_t);
extern "C" __attribute__((import_module("env"),import_name("wavm_caller_store8"))) void caller_store8(uint32_t,uint32_t);
static void constructors(){static bool done=false;if(!done){done=true;__wasm_call_ctors();}}
extern "C" uint32_t gl3chess__execute(uint32_t ptr,uint32_t size,uint32_t out,uint32_t capacity){
 constructors();if(size>MaxState+16384||capacity>MaxState+16384)return 0;Bytes input(size);
 uint32_t i=0;for(;i+4<=size;i+=4){auto x=caller_load32(ptr+i);std::memcpy(input.data()+i,&x,4);}for(;i<size;++i)input[i]=caller_load8(ptr+i);
 auto result=run(input.data(),input.size());if(result.empty()||result.size()>capacity)return 0;
 i=0;for(;i+4<=result.size();i+=4){uint32_t x;std::memcpy(&x,result.data()+i,4);caller_store32(out+i,x);}for(;i<result.size();++i)caller_store8(out+i,result[i]);return uint32_t(result.size());
}
#endif
