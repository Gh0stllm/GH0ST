// SPDX-License-Identifier: GPL-3.0-or-later
// Retained Stockfish engine: pinned coordinator, one reserved game, durable replies.
#include "gh0st_engine.h"
#include "ic_api.h"
#include "wasm_symbol.h"
#include "hash-library/sha256.h"
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <map>
#include <sstream>
#include <set>
#include <string>
#include <vector>
using Bytes=std::vector<uint8_t>;
constexpr uint64_t NODES=24000000;
constexpr uint32_t HASH_MB=128,QUANTUM=0,MAX_GAME_JOBS=512,MAX_JOBS=4096,MAX_STEPS=256;
constexpr uint64_t INSTRUCTION_TARGET=28000000000ULL;
constexpr size_t MAX_JOURNAL=128*1024*1024;
static const char* JOURNAL="gh0st-hybrid-v1.bin";
struct Job {Bytes game,pos;uint32_t ply{};std::string fen;std::vector<std::string> moves;};
struct Step {std::string phase,best,stop;uint64_t actual{},observed{},instructions{},total{};uint32_t depth{};};
struct Record {Job request;Bytes id;std::vector<Step> replies;};
static std::string coordinator;
static Bytes config,reserved_game,current_job;
static bool faulted=false;
static std::string fault_reason,game_fen;
static std::vector<std::string> previous_moves;
static std::string previous_best;
static uint32_t previous_ply{},game_jobs{};
static bool has_previous=false;
static std::map<std::string,Record> records;
static std::set<std::string> released_games;

static void require(bool ok,const char* why){if(!ok)IC_API::trap(why);}
static std::string key(const Bytes& b){static const char*x="0123456789abcdef";std::string s;for(auto c:b){s+=x[c>>4];s+=x[c&15];}return s;}
static void u32(std::string& s,uint32_t n){for(int i=0;i<4;++i)s+=char(n>>(8*i));}
static void u64(std::string& s,uint64_t n){for(int i=0;i<8;++i)s+=char(n>>(8*i));}
static void put(std::string& s,const std::string& x){u32(s,uint32_t(x.size()));s+=x;}
static void put(std::string& s,const Bytes& x){u32(s,uint32_t(x.size()));if(!x.empty())s.append(reinterpret_cast<const char*>(x.data()),x.size());}
static void putmoves(std::string& s,const std::vector<std::string>& v){u32(s,uint32_t(v.size()));for(auto&x:v)put(s,x);}
static Bytes digest(const std::string& s){SHA256 h;h.add(s.data(),s.size());Bytes b(32);h.getHash(b.data());return b;}
static std::string canonical(const Job& j){std::string s="GH0ST_ENGINE_JOB_V1";put(s,config);put(s,j.game);put(s,j.pos);u32(s,j.ply);put(s,j.fen);putmoves(s,j.moves);return s;}
struct Reader{const std::string&s;size_t p=0;void need(size_t n){require(n<=s.size()-p,"journal truncated");}uint32_t n32(){need(4);uint32_t n=0;for(int i=0;i<4;++i)n|=uint32_t(uint8_t(s[p++]))<<(8*i);return n;}uint64_t n64(){need(8);uint64_t n=0;for(int i=0;i<8;++i)n|=uint64_t(uint8_t(s[p++]))<<(8*i);return n;}std::string text(size_t max){auto n=n32();require(n<=max,"journal field too large");need(n);std::string x=s.substr(p,n);p+=n;return x;}Bytes bytes(size_t max){auto x=text(max);return Bytes(x.begin(),x.end());}std::vector<std::string> moves(){auto n=n32();require(n<=1024,"journal moves overflow");std::vector<std::string> v;for(uint32_t i=0;i<n;++i)v.push_back(text(5));return v;}};
static void persist(){
 std::string s="GH0STHYBRID1";put(s,coordinator);put(s,config);u64(s,NODES);put(s,reserved_game);put(s,current_job);u32(s,faulted);put(s,fault_reason);put(s,game_fen);putmoves(s,previous_moves);put(s,previous_best);u32(s,previous_ply);u32(s,has_previous);u32(s,game_jobs);u32(s,uint32_t(released_games.size()));for(auto&g:released_games)put(s,g);u32(s,uint32_t(records.size()));
 for(auto&[k,r]:records){put(s,r.id);put(s,r.request.game);put(s,r.request.pos);u32(s,r.request.ply);put(s,r.request.fen);putmoves(s,r.request.moves);u32(s,uint32_t(r.replies.size()));for(auto&t:r.replies){put(s,t.phase);put(s,t.best);put(s,t.stop);u64(s,t.actual);u64(s,t.observed);u64(s,t.instructions);u64(s,t.total);u32(s,t.depth);}}
 require(s.size()<MAX_JOURNAL,"journal capacity exhausted");auto h=digest(s);s.append(reinterpret_cast<const char*>(h.data()),h.size());std::ofstream f(JOURNAL,std::ios::binary|std::ios::trunc);require(bool(f),"journal open failed");f.write(s.data(),s.size());f.flush();require(bool(f),"journal write failed");
}
static void restore(){
 std::ifstream f(JOURNAL,std::ios::binary);require(bool(f),"missing durable journal");std::string all((std::istreambuf_iterator<char>(f)),{});require(all.size()>44&&all.size()<MAX_JOURNAL+32,"journal length invalid");std::string s=all.substr(0,all.size()-32);auto h=digest(s);require(std::memcmp(h.data(),all.data()+s.size(),32)==0,"journal checksum mismatch");require(s.substr(0,12)=="GH0STHYBRID1","journal version mismatch");Reader r{s,12};coordinator=r.text(64);config=r.bytes(32);require(r.n64()==NODES,"journal engine policy mismatch");reserved_game=r.bytes(32);current_job=r.bytes(32);faulted=r.n32();fault_reason=r.text(256);game_fen=r.text(128);previous_moves=r.moves();previous_best=r.text(8);previous_ply=r.n32();has_previous=r.n32();game_jobs=r.n32();auto ng=r.n32();require(ng<=MAX_JOBS,"journal game overflow");released_games.clear();for(uint32_t g=0;g<ng;++g)released_games.insert(r.text(64));auto n=r.n32();require(n<=MAX_JOBS,"journal job overflow");records.clear();for(uint32_t i=0;i<n;++i){Record x;x.id=r.bytes(32);x.request.game=r.bytes(32);x.request.pos=r.bytes(32);x.request.ply=r.n32();x.request.fen=r.text(128);x.request.moves=r.moves();auto m=r.n32();require(m>0&&m<=MAX_STEPS,"journal step overflow");for(uint32_t z=0;z<m;++z){Step t;t.phase=r.text(16);t.best=r.text(8);t.stop=r.text(128);t.actual=r.n64();t.observed=r.n64();t.instructions=r.n64();t.total=r.n64();t.depth=r.n32();x.replies.push_back(t);}records.emplace(key(x.id),std::move(x));}require(r.p==s.size(),"journal trailing bytes");
}
static bool authorized(IC_API& ic){return !coordinator.empty()&&ic.get_caller().get_text()==coordinator;}
static void error(IC_API&ic,const std::string&code,const std::string&message,bool refundable=false){CandidTypeRecord e;e.append("code",CandidTypeText{code});e.append("message",CandidTypeText{message});e.append("refundable",CandidTypeBool{refundable});ic.to_wire(CandidTypeVariant{"Err",e});}
static void info(IC_API&ic){CandidTypeRecord r;r.append("coordinator",CandidTypePrincipal{coordinator});r.append("reserved_game",CandidTypeVecNat8{reserved_game});r.append("active_job",CandidTypeVecNat8{current_job});r.append("config_hash",CandidTypeVecNat8{config});r.append("faulted",CandidTypeBool{faulted});r.append("fault_reason",CandidTypeText{fault_reason});r.append("capacity",CandidTypeNat32{1});r.append("cycle_balance",CandidTypeNat{ic.get_canister_self_cycle_balance()});r.append("retained_jobs",CandidTypeNat32{uint32_t(records.size())});r.append("max_jobs",CandidTypeNat32{MAX_JOBS});r.append("nodes",CandidTypeNat64{NODES});r.append("hash_mb",CandidTypeNat32{HASH_MB});r.append("quantum",CandidTypeNat32{QUANTUM});r.append("yield_policy",CandidTypeText{"instruction-budget"});r.append("instruction_target",CandidTypeNat64{INSTRUCTION_TARGET});r.append("engine_commit",CandidTypeText{gh0st_stockfish_commit()});r.append("nnue_sha256",CandidTypeText{gh0st_stockfish_nnue_sha256()});ic.to_wire(CandidTypeVariant{"Ok",r});}
static void progress(IC_API&ic,const Record&r,size_t index){auto&t=r.replies.at(index);CandidTypeRecord o;o.append("game_id",CandidTypeVecNat8{r.request.game});o.append("job_id",CandidTypeVecNat8{r.id});o.append("position_hash",CandidTypeVecNat8{r.request.pos});o.append("config_hash",CandidTypeVecNat8{config});o.append("ply",CandidTypeNat32{r.request.ply});o.append("step",CandidTypeNat32{uint32_t(index+1)});o.append("phase",CandidTypeText{t.phase});o.append("bestmove",CandidTypeText{t.best});o.append("actual_nodes",CandidTypeNat64{t.actual});o.append("observed_nodes",CandidTypeNat64{t.observed});o.append("depth",CandidTypeNat32{t.depth});o.append("stop_reason",CandidTypeText{t.stop});o.append("instructions",CandidTypeNat64{t.instructions});o.append("instructions_total",CandidTypeNat64{t.total});o.append("engine_commit",CandidTypeText{gh0st_stockfish_commit()});o.append("nnue_sha256",CandidTypeText{gh0st_stockfish_nnue_sha256()});ic.to_wire(CandidTypeVariant{"Ok",o});}

// Asyncify memory and engine frames are isolated from every Candid/journal frame.
struct AsyncData{uint32_t pointer,end;};
extern "C" void async_start_unwind(AsyncData*) __attribute__((import_module("asyncify"),import_name("start_unwind")));
extern "C" void async_stop_unwind() __attribute__((import_module("asyncify"),import_name("stop_unwind")));
extern "C" void async_start_rewind(AsyncData*) __attribute__((import_module("asyncify"),import_name("start_rewind")));
extern "C" void async_stop_rewind() __attribute__((import_module("asyncify"),import_name("stop_rewind")));
extern "C" void gh0st_call_on_engine_stack(uint32_t);
extern "C" uint32_t gh0st_current_stack_pointer();
extern "C" int gh0st_stockfish_new_game(void);
extern "C" int gh0st_stockfish_validate(const char*,const char*);
extern "C" void gh0st_stockfish_stop(void);
alignas(16) static uint8_t engine_stack[8*1024*1024+32];
alignas(16) static uint8_t spill_stack[4*1024*1024+32];
static AsyncData spill;static uint32_t mode=0,suspended_sp=0,depth=0;static uint64_t observed=0,actual=0;static int result_code=-1;static char best[8]{};static std::string engine_fen,engine_moves;
static uint32_t ptr(void*p){return uint32_t(reinterpret_cast<uintptr_t>(p));}
static void guards(uint8_t*p,size_t n,bool set){for(size_t i=0;i<16;++i){if(set){p[i]=uint8_t(0xa0+i);p[n-16+i]=uint8_t(0xb0+i);}else require(p[i]==uint8_t(0xa0+i)&&p[n-16+i]==uint8_t(0xb0+i),"engine stack guard failed");}}
extern "C" __attribute__((noinline)) void gh0st_stockfish_yield(uint64_t nodes){if(mode==2){async_stop_rewind();mode=0;return;}observed=nodes;if(IC_API::performance_counter()>=INSTRUCTION_TARGET){mode=1;suspended_sp=gh0st_current_stack_pointer();spill.pointer=ptr(spill_stack+16);spill.end=ptr(spill_stack+sizeof(spill_stack)-16);async_start_unwind(&spill);}}
extern "C" __attribute__((noinline)) void gh0st_engine_thunk(){result_code=gh0st_stockfish_search_history(engine_fen.c_str(),engine_moves.c_str(),NODES,HASH_MB,best,sizeof(best),&actual,&depth);}
extern "C" uint32_t hybrid_engine_begin() __attribute__((export_name("hybrid_engine_begin")));
extern "C" uint32_t hybrid_engine_begin(){require(mode==0||mode==3,"engine already active");mode=0;observed=actual=depth=0;result_code=-1;best[0]=0;guards(engine_stack,sizeof(engine_stack),true);guards(spill_stack,sizeof(spill_stack),true);gh0st_call_on_engine_stack(ptr(engine_stack+sizeof(engine_stack)-16));if(mode==1){async_stop_unwind();return 1;}guards(engine_stack,sizeof(engine_stack),false);guards(spill_stack,sizeof(spill_stack),false);mode=3;return 0;}
extern "C" uint32_t hybrid_engine_advance() __attribute__((export_name("hybrid_engine_advance")));
extern "C" uint32_t hybrid_engine_advance(){require(mode==1,"engine not paused");mode=2;async_start_rewind(&spill);gh0st_call_on_engine_stack(suspended_sp);if(mode==1){async_stop_unwind();return 1;}require(mode==0,"engine rewind incomplete");guards(engine_stack,sizeof(engine_stack),false);guards(spill_stack,sizeof(spill_stack),false);mode=3;return 0;}
static std::string join(const std::vector<std::string>&v){std::string s;for(auto&x:v){if(!s.empty())s+=' ';s+=x;}return s;}
static void complete_step(Record&r,bool pending,bool aborting=false){Step t;t.phase=pending?"Pending":"Completed";t.best=pending?"":std::string(best);t.actual=pending?0:actual;t.observed=observed;t.depth=depth;t.stop=pending?"pending":actual>=NODES?"node_budget":actual>0&&depth==245?"max_depth":"unexplained_stop";if(!pending&&(aborting||result_code!=0||t.stop=="unexplained_stop")){t.phase="Faulted";t.best="";t.stop=aborting?"released_by_coordinator":"engine_fault";faulted=true;fault_reason=t.stop;}t.instructions=IC_API::performance_counter();t.total=t.instructions+(r.replies.empty()?0:r.replies.back().total);require(r.replies.size()<MAX_STEPS,"step capacity exhausted");r.replies.push_back(t);if(!pending&&t.phase=="Completed"){previous_moves=r.request.moves;previous_best=t.best;previous_ply=r.request.ply;has_previous=true;}persist();}
static bool valid_job(const Job&j){if(j.game.size()!=32||j.pos.size()!=32||j.fen.empty()||j.fen.size()>128||j.fen.find('\0')!=std::string::npos||j.moves.size()>1024||j.ply!=j.moves.size())return false;for(auto&m:j.moves){if(m.size()!=4&&m.size()!=5)return false;if(m[0]<'a'||m[0]>'h'||m[1]<'1'||m[1]>'8'||m[2]<'a'||m[2]>'h'||m[3]<'1'||m[3]>'8')return false;if(m.size()==5&&std::string("qrbn").find(m[4])==std::string::npos)return false;}return true;}

void hybrid_init() WASM_SYMBOL_EXPORTED("canister_init");
void hybrid_pre_upgrade() WASM_SYMBOL_EXPORTED("canister_pre_upgrade");
void hybrid_post_upgrade() WASM_SYMBOL_EXPORTED("canister_post_upgrade");
void reserve_game() WASM_SYMBOL_EXPORTED("canister_update reserve_game");
void begin() WASM_SYMBOL_EXPORTED("canister_update begin");
void advance() WASM_SYMBOL_EXPORTED("canister_update advance");
void release_game() WASM_SYMBOL_EXPORTED("canister_update release_game");
void read_progress() WASM_SYMBOL_EXPORTED("canister_update read_progress");
void get_info() WASM_SYMBOL_EXPORTED("canister_update get_info");
void get_result() WASM_SYMBOL_EXPORTED("canister_query get_result");
void status() WASM_SYMBOL_EXPORTED("canister_query status");
void hybrid_init(){IC_API ic(CanisterInit{__func__},false);CandidArgs a;a.append(CandidTypePrincipal{&coordinator});a.append(CandidTypeVecNat8{&config});ic.from_wire(a);CandidTypePrincipal p(coordinator);require(!p.is_anonymous()&&config.size()==32,"invalid pinned coordinator/config");persist();}
void hybrid_pre_upgrade(){IC_API ic(CanisterPreUpgrade{__func__},false);persist();}
void hybrid_post_upgrade(){IC_API ic(CanisterPostUpgrade{__func__},false);restore();mode=0;if(!reserved_game.empty()){faulted=true;fault_reason="upgrade_lost_retained_engine_state";auto it=records.find(key(current_job));if(it!=records.end()&&!it->second.replies.empty()&&it->second.replies.back().phase=="Pending"){Step t=it->second.replies.back();t.phase="Faulted";t.stop=fault_reason;t.best="";t.instructions=0;it->second.replies.push_back(t);}}persist();}
void reserve_game(){IC_API ic(CanisterUpdate{__func__},false);if(!authorized(ic)){error(ic,"Unauthorized","coordinator only");return;}Bytes id;ic.from_wire(CandidTypeVecNat8{&id});if(id.size()!=32){error(ic,"BadRequest","game id must be32bytes");return;}if(!reserved_game.empty()){if(id==reserved_game)info(ic);else error(ic,"Busy","retained engine reserved for another game");return;}if(released_games.count(key(id))){error(ic,"ClosedGame","game id already released");return;}if(released_games.size()>=MAX_JOBS||records.size()>MAX_JOBS-MAX_GAME_JOBS){error(ic,"Capacity","durable reply capacity unavailable");return;}require(gh0st_stockfish_new_game()==0,"engine initialization failed");reserved_game=id;current_job.clear();faulted=false;fault_reason.clear();game_fen.clear();previous_moves.clear();previous_best.clear();has_previous=false;game_jobs=0;mode=3;persist();info(ic);}
void begin(){IC_API ic(CanisterUpdate{__func__},false);if(!authorized(ic)){error(ic,"Unauthorized","coordinator only");return;}Job j;CandidTypeRecord q;q.append("game_id",CandidTypeVecNat8{&j.game});q.append("position_hash",CandidTypeVecNat8{&j.pos});q.append("ply",CandidTypeNat32{&j.ply});q.append("initial_fen",CandidTypeText{&j.fen});q.append("moves",CandidTypeVecText{&j.moves});ic.from_wire(q);if(!valid_job(j)){error(ic,"BadRequest","invalid FEN/history encoding or ply",true);return;}if(released_games.count(key(j.game))){error(ic,"ClosedGame","released game cannot begin again");return;}Bytes id=digest(canonical(j));auto old=records.find(key(id));if(old!=records.end()){progress(ic,old->second,0);return;}for(auto&[k,r]:records)if(r.request.game==j.game&&r.request.ply==j.ply){error(ic,"ConflictingJob","same game/ply has different request",true);return;}if(j.game!=reserved_game||reserved_game.empty()){error(ic,"NotReserved","reserve this game before accepting entry");return;}if(faulted){error(ic,"EngineFault",fault_reason,true);return;}if(mode==1){error(ic,"Busy","active search must finish");return;}if(game_jobs>=MAX_GAME_JOBS||records.size()>=MAX_JOBS){error(ic,"Capacity","game or journal job capacity exhausted",true);return;}if(has_previous){if(j.fen!=game_fen||j.moves.size()!=previous_moves.size()+2||j.ply!=previous_ply+2||!std::equal(previous_moves.begin(),previous_moves.end(),j.moves.begin())||j.moves[previous_moves.size()]!=previous_best){error(ic,"HistoryMismatch","history must extend the completed bot move and one human move",true);return;}}else if(!game_fen.empty()&&game_fen!=j.fen){error(ic,"HistoryMismatch","initial FEN changed",true);return;}std::string history=join(j.moves);if(gh0st_stockfish_validate(j.fen.c_str(),history.c_str())!=0){error(ic,"IllegalPosition","Stockfish rejected FEN or move history",true);return;}game_fen=j.fen;engine_fen=j.fen;engine_moves=history;Record rec;rec.request=j;rec.id=id;auto [it,inserted]=records.emplace(key(id),std::move(rec));require(inserted,"job insertion failed");current_job=id;++game_jobs;bool pending=hybrid_engine_begin();complete_step(it->second,pending);progress(ic,it->second,0);}
void advance(){IC_API ic(CanisterUpdate{__func__},false);if(!authorized(ic)){error(ic,"Unauthorized","coordinator only");return;}Bytes id;uint32_t expected{};CandidArgs a;a.append(CandidTypeVecNat8{&id});a.append(CandidTypeNat32{&expected});ic.from_wire(a);auto it=records.find(key(id));if(id.size()!=32||it==records.end()){error(ic,"UnknownJob","job not found");return;}auto&r=it->second;if(expected>0&&expected<r.replies.size()){progress(ic,r,expected);return;}if(expected!=r.replies.size()||expected==0){error(ic,"StepMismatch","expected step is not current");return;}if(r.replies.back().phase!="Pending"){progress(ic,r,r.replies.size()-1);return;}if(faulted||id!=current_job||mode!=1){error(ic,"EngineFault",fault_reason.empty()?"continuation unavailable":fault_reason,true);return;}bool pending=hybrid_engine_advance();complete_step(r,pending);progress(ic,r,r.replies.size()-1);}
void release_game(){IC_API ic(CanisterUpdate{__func__},false);if(!authorized(ic)){error(ic,"Unauthorized","coordinator only");return;}Bytes id;ic.from_wire(CandidTypeVecNat8{&id});if(reserved_game.empty()){info(ic);return;}if(id!=reserved_game){error(ic,"WrongGame","reserved game differs");return;}if(mode==1){gh0st_stockfish_stop();bool pending=hybrid_engine_advance();require(!pending,"cancel did not finish");auto it=records.find(key(current_job));require(it!=records.end(),"missing active job");complete_step(it->second,false,true);}released_games.insert(key(reserved_game));for(auto it=records.begin();it!=records.end();){if(it->second.request.game==reserved_game)it=records.erase(it);else ++it;}reserved_game.clear();current_job.clear();mode=0;has_previous=false;game_fen.clear();previous_moves.clear();previous_best.clear();game_jobs=0;faulted=false;fault_reason.clear();persist();info(ic);}
static void read(IC_API&ic){if(!authorized(ic)){error(ic,"Unauthorized","coordinator only");return;}Bytes id;ic.from_wire(CandidTypeVecNat8{&id});auto it=records.find(key(id));if(id.size()!=32||it==records.end()){error(ic,"UnknownJob","job not found");return;}progress(ic,it->second,it->second.replies.size()-1);}
void read_progress(){IC_API ic(CanisterUpdate{__func__},false);read(ic);}
void get_result(){IC_API ic(CanisterQuery{__func__},false);read(ic);}
void get_info(){IC_API ic(CanisterUpdate{__func__},false);if(!authorized(ic)){error(ic,"Unauthorized","coordinator only");return;}info(ic);}
void status(){IC_API ic(CanisterQuery{__func__},false);info(ic);}

#ifdef HYBRID_TEST_VOLUME
// Test build only: populate conservative worst-case durable reply volume.
void test_seed_volume() WASM_SYMBOL_EXPORTED("canister_update test_seed_volume");
void test_seed_volume(){IC_API ic(CanisterUpdate{__func__},false);require(authorized(ic)&&mode!=1,"test setup refused");records.clear();Job j;j.game=Bytes(32,0x77);j.pos=Bytes(32,0x88);j.fen=std::string(128,'x');j.moves=std::vector<std::string>(1024,"a7a8q");Step t;t.phase="Completed";t.best="a7a8q";t.stop="node_budget";t.actual=NODES;t.observed=NODES;t.depth=245;t.instructions=10000000000;t.total=2400000000000;for(uint32_t i=0;i<MAX_GAME_JOBS;++i){Record r;r.request=j;r.request.ply=i;r.id=digest("VOLUME"+std::to_string(i));r.replies=std::vector<Step>(MAX_STEPS,t);records.emplace(key(r.id),std::move(r));}persist();ic.to_wire(CandidTypeNat64{IC_API::performance_counter()});}
#endif

#ifdef OPTIMIZED_PROFILE
static uint64_t profile_ft=0,profile_affine=0,profile_calls=0;
extern "C" uint64_t gh0st_profile_now(){return IC_API::performance_counter();}
extern "C" void gh0st_profile_nnue(uint64_t ft,uint64_t affine){profile_ft+=ft;profile_affine+=affine;++profile_calls;}
void test_profile() WASM_SYMBOL_EXPORTED("canister_query test_profile");
void test_profile(){IC_API ic(CanisterQuery{__func__},false);require(authorized(ic),"test profile caller");CandidTypeRecord r;r.append("feature_transform",CandidTypeNat64{profile_ft});r.append("affine",CandidTypeNat64{profile_affine});r.append("evaluations",CandidTypeNat64{profile_calls});ic.to_wire(r);}
#endif
