// SPDX-License-Identifier: GPL-3.0-or-later
// Canonical logical retained state. No process pointers, threads or native padding.
#pragma once
#include <cstring>
#include <functional>
#include <type_traits>
#include <vector>
#include "engine.h"
namespace Stockfish {
struct CheckpointAccess {
 using Bytes=std::vector<unsigned char>;
 struct Reader {
  const Bytes& b; size_t at=0;
  bool take(void* p,size_t n){if(at>b.size()||n>b.size()-at)return false;std::memcpy(p,b.data()+at,n);at+=n;return true;}
  template<class T> bool pod(T& x){static_assert(std::is_trivially_copyable_v<T>);return take(&x,sizeof x);}
 };
 template<class T> static void put(Bytes& b,const T& x){auto p=reinterpret_cast<const unsigned char*>(&x);b.insert(b.end(),p,p+sizeof x);}
 static void block(Bytes& b,const void* p,size_t n){put(b,uint64_t(n));auto q=static_cast<const unsigned char*>(p);b.insert(b.end(),q,q+n);}
 template<class T,int D,bool S,class F> static void visit(StatsEntry<T,D,S>& x,F f){f(x,D);}
 template<class T,usize N,usize...Ns,class F> static void visit(MultiArray<T,N,Ns...>& x,F f){for(auto& a:x)visit(a,f);}
 template<class T,int D,class F> static void visit(CorrectionBundle<T,D>& x,F f){visit(x.pawn,f);visit(x.minor,f);visit(x.nonPawnWhite,f);visit(x.nonPawnBlack,f);}
 template<class T,int M,class F> static void visit(DynStats<T,M>& x,F f){for(size_t i=0;i<x.get_size();++i)visit(x[i],f);}
 template<class T,size_t N,class F> static void visit(T(&x)[N],F f){for(auto& a:x)visit(a,f);}
 template<class T> static void logical(Bytes& b,T& x){std::vector<int16_t> a;visit(x,[&](auto& v,int){a.push_back(int16_t(v));});block(b,a.data(),a.size()*2);}
 static Search::Worker& worker(Engine& e){return *e.threads.main_thread()->worker;}
 static Bytes capture(Engine& e){
  auto& w=worker(e);auto& m=*e.threads.main_manager();auto& sh=w.sharedHistory;
  Bytes b;b.reserve(160*1024*1024);
  put(b,uint64_t(e.tt.clusterCount));put(b,e.tt.generation8);block(b,e.tt.table,e.tt.clusterCount*32);
  logical(b,w.mainHistory);logical(b,w.captureHistory);logical(b,w.continuationCorrectionHistory);logical(b,w.ttMoveHistory);
  put(b,uint64_t(sh.correctionHistory.get_size()));logical(b,sh.correctionHistory);logical(b,sh.continuationHistoryBlock->table);
  put(b,uint64_t(sh.pawnHistory.get_size()));logical(b,sh.pawnHistory);
  // Finny cache is serialized field-by-field, omitting architecture padding.
  for(auto& square:w.refreshTable.entries)for(auto& c:square){
   block(b,c.accumulation.data(),c.accumulation.size()*sizeof(c.accumulation[0]));
   block(b,c.psqtAccumulation.data(),c.psqtAccumulation.size()*sizeof(c.psqtAccumulation[0]));
   for(auto piece:c.pieces)put(b,uint8_t(piece));put(b,uint64_t(c.pieceBB));
  }
  put(b,m.originalTimeAdjust);put(b,m.callsCnt);put(b,m.previousTimeReduction);
  put(b,m.bestPreviousScore);put(b,m.bestPreviousAverageScore);put(b,m.tm.availableNodes);
  return b;
 }
 static bool restore(Engine& e,const Bytes& b){
  auto& w=worker(e);auto& m=*e.threads.main_manager();auto& sh=w.sharedHistory;Reader r{b};
  std::vector<std::function<void()>> pending;
  auto copy=[&](void* to,size_t n){uint64_t count;if(!r.pod(count)||count!=n||r.at>b.size()||n>b.size()-r.at)return false;size_t at=r.at;r.at+=n;pending.push_back([&,to,n,at]{std::memcpy(to,b.data()+at,n);});return true;};
  auto scalar=[&](auto& to){using T=std::remove_reference_t<decltype(to)>;T x;if(!r.pod(x))return false;pending.push_back([target=&to,x]{*target=x;});return true;};
  auto logicalCopy=[&](auto& to){uint64_t n;if(!r.pod(n)||r.at>b.size()||n>b.size()-r.at)return false;size_t at=r.at,used=0;bool valid=true;
   visit(to,[&](auto&,int limit){int16_t x=0;if(used+2>n){valid=false;return;}std::memcpy(&x,b.data()+at+used,2);used+=2;if(x < -limit || x > limit)valid=false;});
   if(!valid||used!=n)return false;r.at+=n;pending.push_back([target=&to,at,&b]{size_t i=0;visit(*target,[&](auto& v,int){int16_t x;std::memcpy(&x,b.data()+at+i,2);v=x;i+=2;});});return true;};
  uint64_t clusters;unsigned char generation;
  if(!r.pod(clusters)||clusters!=e.tt.clusterCount||clusters*32!=128*1024*1024||!r.pod(generation)||generation>31)return false;
  if(!copy(e.tt.table,clusters*32)||!logicalCopy(w.mainHistory)||!logicalCopy(w.captureHistory)||!logicalCopy(w.continuationCorrectionHistory)||!logicalCopy(w.ttMoveHistory))return false;
  uint64_t count;if(!r.pod(count)||count!=sh.correctionHistory.get_size()||!logicalCopy(sh.correctionHistory)||!logicalCopy(sh.continuationHistoryBlock->table))return false;
  if(!r.pod(count)||count!=sh.pawnHistory.get_size()||!logicalCopy(sh.pawnHistory))return false;
  for(auto& square:w.refreshTable.entries)for(auto& c:square){
   if(!copy(c.accumulation.data(),c.accumulation.size()*sizeof(c.accumulation[0]))||!copy(c.psqtAccumulation.data(),c.psqtAccumulation.size()*sizeof(c.psqtAccumulation[0])))return false;
   for(auto& piece:c.pieces){uint8_t x;if(!r.pod(x)||x>15)return false;pending.push_back([target=&piece,x]{*target=Piece(x);});}
   uint64_t bb;if(!r.pod(bb))return false;pending.push_back([target=&c.pieceBB,bb]{*target=bb;});
  }
  if(!scalar(m.originalTimeAdjust)||!scalar(m.callsCnt)||!scalar(m.previousTimeReduction)||!scalar(m.bestPreviousScore)||!scalar(m.bestPreviousAverageScore)||!scalar(m.tm.availableNodes)||r.at!=b.size())return false;
  for(auto& f:pending)f();e.tt.generation8=generation;return true;
 }
};
}
