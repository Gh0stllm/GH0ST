// Experimental exact Stockfish continuation; local research only.
#include "gh0st_engine.h"
#include <cstdint>
#include <string>
#include <cstring>
#include "wasm_symbol.h"
struct AsyncData { uint32_t pointer,end; };
extern "C" void async_start_unwind(AsyncData*) __attribute__((import_module("asyncify"),import_name("start_unwind")));
extern "C" void async_stop_unwind() __attribute__((import_module("asyncify"),import_name("stop_unwind")));
extern "C" void async_start_rewind(AsyncData*) __attribute__((import_module("asyncify"),import_name("start_rewind")));
extern "C" void async_stop_rewind() __attribute__((import_module("asyncify"),import_name("stop_rewind")));
extern "C" void gh0st_call_on_engine_stack(uint32_t);
extern "C" uint32_t gh0st_current_stack_pointer();
alignas(16) static uint8_t engine_stack[8*1024*1024+32];
alignas(16) static uint8_t spill_stack[4*1024*1024+32];
static AsyncData spill;
static uint32_t mode,quantum,initial_top,suspended_sp,steps,nodes_limit,depth;
static uint64_t next_yield,observed_nodes,actual;
static int result_code;
static std::string fen,moves;
static char best[8];
static void check(bool x) { if(!x)__builtin_trap(); }
static uint32_t ptr(void* p) { return uint32_t(reinterpret_cast<uintptr_t>(p)); }
static void guards(uint8_t* p,size_t n,bool set) {
 for(size_t i=0;i<16;++i) { if(set){p[i]=uint8_t(0xa0+i);p[n-16+i]=uint8_t(0xb0+i);}else check(p[i]==uint8_t(0xa0+i)&&p[n-16+i]==uint8_t(0xb0+i)); }
}
extern "C" __attribute__((noinline)) void gh0st_stockfish_yield(uint64_t nodes) {
 if(mode==2){async_stop_rewind();mode=0;return;}
 observed_nodes=nodes;
 if(quantum && nodes>=next_yield){
  next_yield=nodes+quantum;mode=1;
  suspended_sp=gh0st_current_stack_pointer();
  spill.pointer=ptr(spill_stack+16);spill.end=ptr(spill_stack+sizeof(spill_stack)-16);
  async_start_unwind(&spill);
 }
}
extern "C" __attribute__((noinline)) void gh0st_engine_thunk() {
 result_code=gh0st_stockfish_search_history(fen.c_str(),moves.c_str(),nodes_limit,128,best,sizeof(best),&actual,&depth);
}
extern "C" uint32_t gh0st_async_begin(uint32_t budget,uint32_t every,uint32_t position) __attribute__((export_name("gh0st_async_begin")));
extern "C" uint32_t gh0st_async_begin(uint32_t budget,uint32_t every,uint32_t position) {
 check(mode==0||mode==3);mode=0;nodes_limit=budget;quantum=every;next_yield=every;observed_nodes=actual=depth=0;steps=1;result_code=-1;best[0]=0;
 fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";moves=position==1?"e2e4":"";
 if(position==2)fen="r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
 guards(engine_stack,sizeof(engine_stack),true);guards(spill_stack,sizeof(spill_stack),true);
 initial_top=ptr(engine_stack+sizeof(engine_stack)-16);
 gh0st_call_on_engine_stack(initial_top);
 if(mode==1){async_stop_unwind();return 1;}
 guards(engine_stack,sizeof(engine_stack),false);guards(spill_stack,sizeof(spill_stack),false);mode=3;return 0;
}
extern "C" uint32_t gh0st_async_advance() __attribute__((export_name("gh0st_async_advance")));
extern "C" uint32_t gh0st_async_advance() {
 check(mode==1);++steps;mode=2;async_start_rewind(&spill);gh0st_call_on_engine_stack(suspended_sp);
 if(mode==1){async_stop_unwind();return 1;}
 check(mode==0);guards(engine_stack,sizeof(engine_stack),false);guards(spill_stack,sizeof(spill_stack),false);mode=3;return 0;
}
extern "C" uint64_t gh0st_async_nodes() __attribute__((export_name("gh0st_async_nodes")));
extern "C" uint64_t gh0st_async_nodes(){return actual;}
extern "C" uint32_t gh0st_async_depth() __attribute__((export_name("gh0st_async_depth")));
extern "C" uint32_t gh0st_async_depth(){return depth;}
extern "C" uint32_t gh0st_async_best() __attribute__((export_name("gh0st_async_best")));
extern "C" uint32_t gh0st_async_best(){return ptr(best);}
extern "C" uint32_t gh0st_async_steps() __attribute__((export_name("gh0st_async_steps")));
extern "C" uint32_t gh0st_async_steps(){return steps;}
extern "C" int gh0st_async_code() __attribute__((export_name("gh0st_async_code")));
extern "C" int gh0st_async_code(){return result_code;}

// Test-only entry points. This fake local test principal has no production key.
#include "ic_api.h"
static bool local_authority(IC_API& ic) {
 return ic.get_caller().get_text()=="tfrqx-xeukf-awg63-5b7i6-lf6ss-2obc2-53bij-ui3ja-h6vi7-smkqt-7ae";
}
extern "C" uint64_t gh0st_instruction_counter(uint32_t) __attribute__((import_module("ic0"),import_name("performance_counter")));
static void prototype_reply(IC_API& ic,uint32_t pending) {
 CandidTypeRecord r;
 r.append("pending",CandidTypeBool{bool(pending)});
 r.append("step",CandidTypeNat32{steps});
 r.append("bestmove",CandidTypeText{std::string(best)});
 r.append("actual_nodes",CandidTypeNat64{actual});
 r.append("observed_nodes",CandidTypeNat64{observed_nodes});
 r.append("depth",CandidTypeNat32{depth});
 r.append("code",CandidTypeInt32{int32_t(result_code)});
 r.append("instructions",CandidTypeNat64{gh0st_instruction_counter(0)});
 ic.to_wire(r);
}
void prototype_begin() WASM_SYMBOL_EXPORTED("canister_update prototype_begin");
void prototype_advance() WASM_SYMBOL_EXPORTED("canister_update prototype_advance");
void prototype_begin() {
 IC_API ic(CanisterUpdate{std::string(__func__)},false);
 if(!local_authority(ic))IC_API::trap("test-only authority");
 uint32_t budget{},every{},position{};CandidArgs args;
 args.append(CandidTypeNat32{&budget});args.append(CandidTypeNat32{&every});args.append(CandidTypeNat32{&position});ic.from_wire(args);
 if(budget>10000000||budget==0||every>100000||every==0||position>2)IC_API::trap("invalid prototype test input");
 uint32_t pending=gh0st_async_begin(budget,every,position);prototype_reply(ic,pending);
}
void prototype_advance() {
 IC_API ic(CanisterUpdate{std::string(__func__)},false);
 if(!local_authority(ic))IC_API::trap("test-only authority");
 uint32_t pending=gh0st_async_advance();prototype_reply(ic,pending);
}
