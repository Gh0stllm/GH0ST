// SPDX-License-Identifier: GPL-3.0-or-later
#include <cassert>
#include <chrono>
#include <fstream>
#include <iostream>
#include <sstream>
#include "attacks.h"
#include "checkpoint.h"
#include "tune.h"
using namespace Stockfish;
static constexpr const char* Fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
using Clock=std::chrono::steady_clock;
static double seconds(Clock::time_point t){return std::chrono::duration<double>(Clock::now()-t).count();}
static void option(Engine& e,const std::string& n,const std::string& v){std::istringstream s("name "+n+" value "+v);e.get_options().setoption(s);}
static void init(Engine& e){Tune::init(e.get_options());e.get_options().add_info_listener([](std::optional<std::string>){});for(auto [n,v]:std::vector<std::pair<std::string,std::string>>{{"NumaPolicy","none"},{"Threads","1"},{"Hash","128"},{"Skill Level","20"},{"UCI_LimitStrength","false"},{"MultiPV","1"},{"Ponder","false"},{"SyzygyPath",""}})option(e,n,v);e.set_on_verify_network([](std::string_view){});e.set_on_update_no_moves([](const Engine::InfoShort&){});e.set_on_iter([](const Engine::InfoIter&){});e.set_on_start([]{});e.search_clear();}
static CheckpointAccess::CachedResult search(Engine& e,const std::vector<std::string>& moves,std::uint64_t nodes){
 if(e.set_position(Fen,moves))throw std::runtime_error("illegal history");CheckpointAccess::CachedResult r{};e.set_on_bestmove([&](std::string_view b,std::string_view){r.best=b;});e.set_on_update_full([&](const Engine::InfoFull&i){r.nodes=i.nodes;r.depth=i.depth;});Search::LimitsType l;l.nodes=nodes;l.startTime=0;e.go(l);e.wait_for_search_finished();e.set_on_bestmove([](std::string_view,std::string_view){});e.set_on_update_full([](const Engine::InfoFull&){});return r;
}
int main(int argc,char**argv){try{
 const std::uint64_t nodes=argc>1?std::stoull(argv[1]):24000000; if(nodes!=24000000)throw std::runtime_error("full24m test only");
 std::ifstream executable(argv[0],std::ios::binary);std::vector<unsigned char> executableBytes((std::istreambuf_iterator<char>(executable)),{});if(executableBytes.empty())throw std::runtime_error("executable identity unavailable");CheckpointAccess::artifactIdentity=CheckpointAccess::hash(executableBytes);executableBytes.clear();executableBytes.shrink_to_fit();
 Attacks::init();Position::init();Engine a,b;init(a);init(b);
 auto incoming=CheckpointAccess::hash(CheckpointAccess::retained(a));if(incoming!=CheckpointAccess::hash(CheckpointAccess::retained(b)))throw std::runtime_error("new game state not canonical");
 auto start=Clock::now();auto first=search(a,{"e2e4"},nodes);double searchSeconds=seconds(start);
 start=Clock::now();auto checkpoint=CheckpointAccess::capture(a,"e2e4",incoming,first);double saveSeconds=seconds(start);auto postHash=CheckpointAccess::hash(CheckpointAccess::retained(a));
 // Reject corruption and a different complete-history key before live mutation.
 unsigned rejected=0;for(int mode=0;mode<5;++mode){auto bad=checkpoint;if(mode==0)bad[bad.size()/2]^=1;if(mode==1)bad.pop_back();if(mode==2)bad.push_back(0);auto before=CheckpointAccess::hash(CheckpointAccess::retained(b));try{CheckpointAccess::restore(b,bad,mode==3?"g1f3 e7e5 f3g1":"e2e4",mode==4?std::string(64,'0'):incoming);throw std::runtime_error("bad restore accepted");}catch(const std::runtime_error&x){if(std::string(x.what())=="bad restore accepted")throw;}if(before!=CheckpointAccess::hash(CheckpointAccess::retained(b)))throw std::runtime_error("rejected restore mutated engine");++rejected;}
 start=Clock::now();auto reused=CheckpointAccess::restore(b,checkpoint,"e2e4",incoming);double restoreSeconds=seconds(start);if(first.best!=reused.best||first.nodes!=reused.nodes||first.depth!=reused.depth||postHash!=CheckpointAccess::hash(CheckpointAccess::retained(b)))throw std::runtime_error("post-state differs");
 std::cout<<"{\"event\":\"checkpoint\",\"bytes\":"<<checkpoint.size()<<",\"initial_bestmove\":\""<<first.best<<"\",\"nodes\":"<<first.nodes<<",\"depth\":"<<first.depth<<",\"search_seconds\":"<<searchSeconds<<",\"save_seconds\":"<<saveSeconds<<",\"restore_seconds\":"<<restoreSeconds<<",\"negative_cases\":"<<rejected<<",\"post_state_sha256\":\""<<postHash<<"\"}"<<std::endl;
 std::vector<std::string> history={"e2e4",first.best,"g1f3"};
 for(int step=0;step<2;++step){auto ra=search(a,history,nodes),rb=search(b,history,nodes);auto ha=CheckpointAccess::hash(CheckpointAccess::retained(a)),hb=CheckpointAccess::hash(CheckpointAccess::retained(b));if(ra.best!=rb.best||ra.nodes!=rb.nodes||ra.depth!=rb.depth||ha!=hb)throw std::runtime_error("future retained search differs");std::cout<<"{\"event\":\"future_search\",\"step\":"<<step<<",\"bestmove\":\""<<ra.best<<"\",\"nodes\":"<<ra.nodes<<",\"depth\":"<<ra.depth<<",\"state_sha256\":\""<<ha<<"\",\"exact\":true}"<<std::endl;if(step==0){history.push_back(ra.best);history.push_back("f1b5");}}
 a.search_clear();b.search_clear();if(CheckpointAccess::hash(CheckpointAccess::retained(a))!=incoming||CheckpointAccess::hash(CheckpointAccess::retained(b))!=incoming)throw std::runtime_error("new-game reset retained state differs");
 std::cout<<"{\"event\":\"new_game_reset\",\"canonical_incoming_state\":true}"<<std::endl;
 std::cout<<"{\"event\":\"complete\",\"passed\":true,\"full24m_searches\":5,\"restored_future_decisions\":2,\"scope\":\"native test-only logical retained state; no ICP cache or spend\"}"<<std::endl;
 }catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}}
