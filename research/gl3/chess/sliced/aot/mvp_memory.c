// SPDX-License-Identifier: GPL-3.0-or-later
// Proof-only MVP implementations: the SDK libc otherwise uses bulk-memory
// opcodes which the pinned WAVM parser does not accept. Volatile accesses and
// -fno-builtin prevent the compiler from recreating memory.copy/memory.fill.
#include <stddef.h>
#include <stdint.h>
void* memcpy(void* restrict dst,const void* restrict src,size_t n) {
  volatile unsigned char* d=dst;
  const volatile unsigned char* s=src;
  if ((((uintptr_t)d|(uintptr_t)s)&7)==0) {
    while (n>=8) {*(volatile uint64_t*)d=*(const volatile uint64_t*)s;d+=8;s+=8;n-=8;}
  }
  while (n--) *d++=*s++;
  return dst;
}
void* memmove(void* dst,const void* src,size_t n) {
  volatile unsigned char* d=dst;
  const volatile unsigned char* s=src;
  if ((uintptr_t)d<=(uintptr_t)s || (uintptr_t)d-(uintptr_t)s>=n) {
    if ((((uintptr_t)d|(uintptr_t)s)&7)==0) {
      while (n>=8) {*(volatile uint64_t*)d=*(const volatile uint64_t*)s;d+=8;s+=8;n-=8;}
    }
    while (n--) *d++=*s++;
  } else {
    d+=n;s+=n;
    if ((((uintptr_t)d|(uintptr_t)s)&7)==0) {
      while (n>=8) {d-=8;s-=8;*(volatile uint64_t*)d=*(const volatile uint64_t*)s;n-=8;}
    }
    while (n--) *--d=*--s;
  }
  return dst;
}
void* memset(void* dst,int value,size_t n) {
  volatile unsigned char* d=dst;unsigned char c=(unsigned char)value;
  while (n&&((uintptr_t)d&7)) {*d++=c;--n;}
  uint64_t word=(uint64_t)c*UINT64_C(0x0101010101010101);
  while (n>=8) {*(volatile uint64_t*)d=word;d+=8;n-=8;}
  while (n--) *d++=c;
  return dst;
}
