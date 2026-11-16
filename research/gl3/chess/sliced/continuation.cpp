// SPDX-License-Identifier: GPL-3.0-or-later
// The search policy and arithmetic are shared with the pinned monolithic lane.
#include "../engine/engine.cpp"
#include <memory>

struct AsyncData { uint32_t pointer,end; };
extern "C" void async_start_unwind(AsyncData*) __attribute__((import_module("asyncify"),import_name("start_unwind")));
extern "C" void async_stop_unwind() __attribute__((import_module("asyncify"),import_name("stop_unwind")));
extern "C" void async_start_rewind(AsyncData*) __attribute__((import_module("asyncify"),import_name("start_rewind")));
extern "C" void async_stop_rewind() __attribute__((import_module("asyncify"),import_name("stop_rewind")));
extern "C" void gh0st_call_on_engine_stack(uint32_t);
extern "C" uint32_t gh0st_current_stack_pointer();
alignas(16) static unsigned char engine_stack[8*1024*1024+32];
alignas(16) static unsigned char spill_stack[4*1024*1024+32];
static AsyncData spill;
static std::unique_ptr<Engine> live;
static uint32_t mode=0, suspended_sp=0, steps=0, depth=0;
static uint64_t next_yield=0, observed=0, actual=0;
static std::string best;
static Bytes exported;
// Scheduling quantum is not the search budget. Every search still targets 24m.
static constexpr uint64_t Quantum=2048;
static void check(bool ok){if(!ok)__builtin_trap();}
static uint32_t ptr(const void* p){return uint32_t(reinterpret_cast<uintptr_t>(p));}
static void guards(unsigned char* p,size_t n,bool set){for(size_t i=0;i<16;++i){if(set){p[i]=0xa0+i;p[n-16+i]=0xb0+i;}else check(p[i]==0xa0+i&&p[n-16+i]==0xb0+i);}}
extern "C" __attribute__((noinline)) void gh0st_stockfish_yield(uint64_t nodes){
 if(mode==2){async_stop_rewind();mode=0;return;}
 observed=nodes;
 if(nodes>=next_yield){
  next_yield=nodes+Quantum;mode=1;suspended_sp=gh0st_current_stack_pointer();
  spill.pointer=ptr(spill_stack+16);spill.end=ptr(spill_stack+sizeof(spill_stack)-16);
  async_start_unwind(&spill);
 }
}
extern "C" __attribute__((noinline)) void gh0st_engine_thunk(){
 Search::LimitsType limits;limits.nodes=24000000;limits.startTime=0;
 live->go(limits);live->wait_for_search_finished();
}
extern "C" uint32_t gl3_slice_init(){
 check(!live);Attacks::init();Position::init();live=std::make_unique<Engine>();initialize(*live);
 live->set_on_bestmove([](std::string_view move,std::string_view){best=move;});
 live->set_on_update_full([](const Engine::InfoFull& info){actual=info.nodes;depth=info.depth;});
 mode=3;return 1;
}
extern "C" uint32_t gl3_slice_begin(const unsigned char* history,uint32_t n){
 check(live && mode==3 && n>0 && n<=8192);
 std::istringstream input(std::string(reinterpret_cast<const char*>(history),n));
 std::vector<std::string> moves;for(std::string m;input>>m;)moves.push_back(m);
 check(moves.size()%2==1 && !live->set_position("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",moves));
 mode=0;next_yield=Quantum;observed=actual=depth=0;steps=1;best.clear();
 guards(engine_stack,sizeof(engine_stack),true);guards(spill_stack,sizeof(spill_stack),true);
 gh0st_call_on_engine_stack(ptr(engine_stack+sizeof(engine_stack)-16));
 if(mode==1){async_stop_unwind();return 1;}
 check(best.size()>=4 && (actual>=24000000 || depth==245));mode=3;return 0;
}
extern "C" uint32_t gl3_slice_advance(){
 check(live && mode==1);++steps;mode=2;async_start_rewind(&spill);gh0st_call_on_engine_stack(suspended_sp);
 if(mode==1){async_stop_unwind();return 1;}
 check(mode==0 && best.size()>=4 && (actual>=24000000 || depth==245));
 guards(engine_stack,sizeof(engine_stack),false);guards(spill_stack,sizeof(spill_stack),false);mode=3;return 0;
}
extern "C" uint64_t gl3_slice_observed(){return observed;}
extern "C" uint64_t gl3_slice_actual(){return actual;}
extern "C" uint32_t gl3_slice_steps(){return steps;}
extern "C" uint32_t gl3_slice_depth(){return depth;}
extern "C" uint32_t gl3_slice_best(){return ptr(best.c_str());}
// Diagnostic only: full canonical export is deliberately outside a move slice.
extern "C" uint32_t gl3_slice_canonical(){check(mode==3);exported=CheckpointAccess::capture(*live);return ptr(exported.data());}
extern "C" uint32_t gl3_slice_canonical_size(){return exported.size();}
