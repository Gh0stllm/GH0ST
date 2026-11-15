// SPDX-License-Identifier: GPL-3.0-or-later
// Test-only logical Stockfish retained-state serializer. No canister auth/journal bytes.
#pragma once
#include <cstring>
#include <functional>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <vector>
#include "engine.h"
#include "sha256.h"

namespace Stockfish {
struct CheckpointAccess {
    using Bytes = std::vector<unsigned char>;
    static constexpr std::size_t MaxBytes = 192 * 1024 * 1024;
    static constexpr const char* Identity = "SF19-edb0d9db-full1a298aa575a0-NATIVE64LE-Hash128-Th1-Skill20-MPV1-Nodes24m-v1";
    static inline std::string artifactIdentity;
    struct CachedResult { std::string best; std::uint64_t nodes; std::uint32_t depth; };
    struct Reader {
        const Bytes& input; std::size_t at = 0;
        void need(std::size_t n) const { if (n > input.size() - at) throw std::runtime_error("truncated checkpoint"); }
        template<class T> T pod() { static_assert(std::is_trivially_copyable_v<T>); need(sizeof(T)); T x; std::memcpy(&x,input.data()+at,sizeof x);at+=sizeof x;return x; }
        std::string text(std::size_t max) { auto n=pod<std::uint32_t>(); if(n>max)throw std::runtime_error("oversize checkpoint string");need(n);std::string s(reinterpret_cast<const char*>(input.data()+at),n);at+=n;return s; }
    };
    template<class T> static void put(Bytes& out,const T& x) { static_assert(std::is_trivially_copyable_v<T>); auto p=reinterpret_cast<const unsigned char*>(&x);out.insert(out.end(),p,p+sizeof x); }
    static void text(Bytes& out,const std::string& s) { if(s.size()>8192)throw std::runtime_error("oversize text");put(out,std::uint32_t(s.size()));out.insert(out.end(),s.begin(),s.end()); }
    static std::string hash(const Bytes& bytes) { SHA256 h;h.add(bytes.data(),bytes.size());return h.getHash(); }
    static void block(Bytes& out,const void* p,std::size_t n) { put(out,std::uint64_t(n));auto q=static_cast<const unsigned char*>(p);out.insert(out.end(),q,q+n); }
    template<class T> static void value(Bytes& out,const T& x) { static_assert(std::is_trivially_copyable_v<T>); block(out,&x,sizeof x); }
    template<class T,int D,bool Shared,class F> static void visit(StatsEntry<T,D,Shared>& e,F f){f(e,D);}
    template<class T,usize N,usize...Ns,class F> static void visit(MultiArray<T,N,Ns...>& a,F f){for(auto& x:a)visit(x,f);}
    template<class T,int D,class F> static void visit(CorrectionBundle<T,D>& b,F f){visit(b.pawn,f);visit(b.minor,f);visit(b.nonPawnWhite,f);visit(b.nonPawnBlack,f);}
    template<class T,int M,class F> static void visit(DynStats<T,M>& a,F f){for(std::size_t i=0;i<a.get_size();++i)visit(a[i],f);}
    template<class T,std::size_t N,class F> static void visit(T(&a)[N],F f){for(auto& x:a)visit(x,f);}
    template<class T> static void logical(Bytes& out,T& a){std::vector<std::int16_t> values;visit(a,[&](auto& x,int){values.push_back(static_cast<std::int16_t>(x));});block(out,values.data(),values.size()*sizeof(std::int16_t));}
    static Search::Worker& worker(Engine& e) { e.wait_for_search_finished();if(e.threads.size()!=1)throw std::runtime_error("single thread required");return *e.threads.main_thread()->worker; }
    // Only fields which survive into future fixed-node searches. Scratch root moves,
    // position/state links, low-ply fill, recursive stacks and callbacks are rebuilt.
    static Bytes retained(Engine& e) {
        auto& w=worker(e);auto& m=*e.threads.main_manager();Bytes out;out.reserve(160*1024*1024);
        put(out,std::uint64_t(e.tt.clusterCount));put(out,e.tt.generation8);
        block(out,e.tt.table,e.tt.clusterCount*32);
        logical(out,w.mainHistory);logical(out,w.captureHistory);logical(out,w.continuationCorrectionHistory);logical(out,w.ttMoveHistory);
        auto& sh=w.sharedHistory;
        put(out,std::uint64_t(sh.correctionHistory.get_size()));
        logical(out,sh.correctionHistory);
        logical(out,sh.continuationHistoryBlock->table);
        put(out,std::uint64_t(sh.pawnHistory.get_size()));
        logical(out,sh.pawnHistory);
        value(out,w.refreshTable);
        value(out,m.originalTimeAdjust);value(out,m.callsCnt);value(out,m.previousTimeReduction);
        value(out,m.bestPreviousScore);value(out,m.bestPreviousAverageScore);
        // availableNodes is the only TM value not overwritten by tm.init().
        // Preserve it although nodestime=0 makes it inactive in this policy.
        value(out,m.tm.availableNodes);
        if(out.size()>MaxBytes)throw std::runtime_error("checkpoint capacity exceeded");return out;
    }
    static Bytes capture(Engine& e,const std::string& prefix,const std::string& incoming,const CachedResult& r) {
        if(artifactIdentity.size()!=64)throw std::runtime_error("artifact identity missing");
        Bytes out;out.reserve(160*1024*1024);text(out,std::string(Identity)+":"+artifactIdentity);text(out,prefix);text(out,incoming);text(out,r.best);put(out,r.nodes);put(out,r.depth);
        auto state=retained(e);block(out,state.data(),state.size());auto sum=hash(out);text(out,sum);return out;
    }
    static CachedResult restore(Engine& e,const Bytes& full,const std::string& prefix,const std::string& incoming) {
        if(full.size()>MaxBytes||full.size()<100)throw std::runtime_error("checkpoint size invalid");
        Reader envelope{full};if(envelope.text(256)!=std::string(Identity)+":"+artifactIdentity)throw std::runtime_error("checkpoint identity mismatch");
        if(envelope.text(8192)!=prefix)throw std::runtime_error("full move prefix differs");
        if(envelope.text(64)!=incoming||hash(retained(e))!=incoming)throw std::runtime_error("incoming retained state differs");
        CachedResult result{envelope.text(5),envelope.pod<std::uint64_t>(),envelope.pod<std::uint32_t>()};
        if(result.best.size()<4||result.nodes<24000000||result.depth==0)throw std::runtime_error("cached strength result invalid");
        const auto size=envelope.pod<std::uint64_t>();envelope.need(size);const auto bodyStart=envelope.at;envelope.at+=size;const auto checksumStart=envelope.at;
        auto checksum=envelope.text(64);if(envelope.at!=full.size())throw std::runtime_error("checkpoint trailing bytes");
        Bytes checked(full.begin(),full.begin()+checksumStart);if(hash(checked)!=checksum)throw std::runtime_error("checkpoint checksum mismatch");
        Bytes body(full.begin()+bodyStart,full.begin()+bodyStart+size);Reader rd{body};
        auto& w=worker(e);auto& m=*e.threads.main_manager();std::vector<std::function<void()>> pending;
        const auto clusters=rd.pod<std::uint64_t>();if(clusters!=e.tt.clusterCount||clusters*32!=128*1024*1024)throw std::runtime_error("TT shape differs");
        const auto gen=rd.pod<unsigned char>();if(gen>31)throw std::runtime_error("impossible TT generation");
        auto copy=[&](void* dst,std::size_t n){auto length=rd.pod<std::uint64_t>();if(length!=n)throw std::runtime_error("logical layout differs");rd.need(n);const auto offset=rd.at;pending.emplace_back([dst,n,offset,&body]{std::memcpy(dst,body.data()+offset,n);});rd.at+=n;};
        auto logicalCopy=[&](auto& dst){const auto n=rd.pod<std::uint64_t>();rd.need(n);const auto offset=rd.at;std::size_t used=0;visit(dst,[&](auto&,int bound){if(used+2>n)throw std::runtime_error("logical history truncated");std::int16_t v;std::memcpy(&v,body.data()+offset+used,2);if(v < -bound || v > bound)throw std::runtime_error("history value outside bounds");used+=2;});if(used!=n)throw std::runtime_error("logical history shape differs");pending.emplace_back([target=&dst,offset,&body]{std::size_t i=0;visit(*target,[&](auto& entry,int){std::int16_t v;std::memcpy(&v,body.data()+offset+i,2);entry=v;i+=2;});});rd.at+=n;};
        copy(e.tt.table,clusters*32);logicalCopy(w.mainHistory);logicalCopy(w.captureHistory);logicalCopy(w.continuationCorrectionHistory);logicalCopy(w.ttMoveHistory);
        auto& sh=w.sharedHistory;if(rd.pod<std::uint64_t>()!=sh.correctionHistory.get_size())throw std::runtime_error("correction shape differs");
        logicalCopy(sh.correctionHistory);
        logicalCopy(sh.continuationHistoryBlock->table);
        if(rd.pod<std::uint64_t>()!=sh.pawnHistory.get_size())throw std::runtime_error("pawn shape differs");
        logicalCopy(sh.pawnHistory);
        copy(&w.refreshTable,sizeof w.refreshTable);copy(&m.originalTimeAdjust,sizeof m.originalTimeAdjust);copy(&m.callsCnt,sizeof m.callsCnt);copy(&m.previousTimeReduction,sizeof m.previousTimeReduction);copy(&m.bestPreviousScore,sizeof m.bestPreviousScore);copy(&m.bestPreviousAverageScore,sizeof m.bestPreviousAverageScore);copy(&m.tm.availableNodes,sizeof m.tm.availableNodes);
        if(rd.at!=body.size())throw std::runtime_error("state body trailing bytes");
        // No destination byte changes until all integrity/identity/layout checks pass.
        for(auto& f:pending)f();e.tt.generation8=gen;return result;
    }
};
}
