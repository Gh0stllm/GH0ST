// SPDX-License-Identifier: GPL-3.0-or-later
// SYNTHETIC local-only cost probe: no Stockfish, game, auth, signing or token code.
#include "ic_api.h"
#include "wasm_symbol.h"
#include "hash-library/sha256.h"
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
extern "C" std::uint64_t cache_stable_size() __attribute__((import_module("ic0"),import_name("stable64_size")));
extern "C" std::uint64_t cache_stable_grow(std::uint64_t) __attribute__((import_module("ic0"),import_name("stable64_grow")));
extern "C" void cache_stable_write(std::uint64_t,std::uint64_t,std::uint64_t) __attribute__((import_module("ic0"),import_name("stable64_write")));
extern "C" void cache_stable_read(std::uint64_t,std::uint64_t,std::uint64_t) __attribute__((import_module("ic0"),import_name("stable64_read")));
static std::vector<unsigned char> live;
static std::string expected;
static std::string digest(const std::vector<unsigned char>& b){SHA256 h;h.add(b.data(),b.size());return h.getHash();}
static std::uint64_t ptr(const void* p){return reinterpret_cast<std::uintptr_t>(p);}
static void reply(IC_API& ic,bool ok,const std::string& phase,std::uint64_t read=0,std::uint64_t hash=0,std::uint64_t copy=0,std::uint64_t verify=0){CandidTypeRecord r;r.append("ok",CandidTypeBool{ok});r.append("phase",CandidTypeText{phase});r.append("bytes",CandidTypeNat32{std::uint32_t(live.size())});r.append("checksum",CandidTypeText{expected});r.append("read_instructions",CandidTypeNat64{read});r.append("hash_instructions",CandidTypeNat64{hash});r.append("copy_instructions",CandidTypeNat64{copy});r.append("verify_instructions",CandidTypeNat64{verify});r.append("total_instructions",CandidTypeNat64{IC_API::performance_counter()});ic.to_wire(r);}
void init() WASM_SYMBOL_EXPORTED("canister_init");void init(){IC_API ic(CanisterInit{__func__},false);}
void seed() WASM_SYMBOL_EXPORTED("canister_update seed");void seed(){IC_API ic(CanisterUpdate{__func__},false);std::uint32_t n;ic.from_wire(CandidTypeNat32{&n});if(n<1024||n>192*1024*1024)IC_API::trap("synthetic size bounds");live.resize(n);for(std::uint32_t i=0;i<n;++i)live[i]=static_cast<unsigned char>(i*31+7);expected=digest(live);const std::uint64_t pages=(n+65535)/65536;const auto old=cache_stable_size();if(old<pages&&cache_stable_grow(pages-old)==std::uint64_t(-1))IC_API::trap("stable allocation failed");cache_stable_write(0,ptr(live.data()),n);reply(ic,true,"seeded");}
void restore() WASM_SYMBOL_EXPORTED("canister_update restore");void restore(){IC_API ic(CanisterUpdate{__func__},false);if(live.empty())IC_API::trap("seed first");std::vector<unsigned char> candidate(live.size());auto a=IC_API::performance_counter();cache_stable_read(ptr(candidate.data()),0,candidate.size());auto b=IC_API::performance_counter();auto checksum=digest(candidate);auto c=IC_API::performance_counter();if(checksum!=expected){reply(ic,false,"checksum_rejected_before_mutation",b-a,c-b);return;}std::memcpy(live.data(),candidate.data(),candidate.size());auto d=IC_API::performance_counter();if(digest(live)!=expected)IC_API::trap("restored checksum differs");auto e=IC_API::performance_counter();reply(ic,true,"restored",b-a,c-b,d-c,e-d);}
void corrupt() WASM_SYMBOL_EXPORTED("canister_update corrupt");void corrupt(){IC_API ic(CanisterUpdate{__func__},false);unsigned char x=0;cache_stable_write(0,ptr(&x),1);reply(ic,true,"stable_corrupted_for_test");}
void inspect() WASM_SYMBOL_EXPORTED("canister_update inspect");void inspect(){IC_API ic(CanisterUpdate{__func__},false);reply(ic,digest(live)==expected,"live_checked");}
