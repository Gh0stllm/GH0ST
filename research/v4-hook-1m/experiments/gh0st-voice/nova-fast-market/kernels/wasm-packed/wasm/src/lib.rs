//! Exact Q10 N0VA forward kernel for local WASM backend research.
//! Not an activated Stylus contract. Node host adapter supplies immutable code bytes.
#![no_std]
#![allow(static_mut_refs)]
use core::panic::PanicInfo;
#[panic_handler] fn panic(_: &PanicInfo) -> ! { core::arch::wasm32::unreachable() }
#[link(wasm_import_module="vm_hooks")]
extern "C" {
 fn account_code(address:*const u8,offset:usize,size:usize,dest:*mut u8)->usize;
 fn native_keccak256(input:*const u8,length:usize,output:*mut u8);
}
const H:usize=384; const ROW:usize=1028; const CORE_MATRIX:usize=3538944;
static mut PACK_OLD1:[i64;128]=[0;128];
static mut PACK_OLD2:[i64;128]=[0;128];
static mut PACK_NEW1:[i64;128]=[0;128];
static mut PACK_NEW2:[i64;128]=[0;128];
static mut CORE:[u8;3555072]=[0;3555072];
static mut GROUPS:[u8;131584]=[0;131584];
static mut HEAD:[u8;65792]=[0;65792];
static mut PUNCT:[u8;5140]=[0;5140];
static mut ROW_TOKEN:[u8;5760]=[0;5760];
static mut ROW_PUNCT:[u8;5760]=[0;5760];
static mut DELTA:[u8;514]=[0;514];
static mut EXP:[u8;2056]=[0;2056];
static mut STATE:[i16;768]=[0;768];
static mut NEXT:[i16;768]=[0;768];
static mut SCORES:[i64;197]=[0;197];
static mut RESULT:[u32;64]=[0;64];
static mut SEED:[u8;32]=[0;32];
static mut FEATURES:[i32;6]=[0;6];
static mut PREVIOUS:usize=8192;
static mut PREVIOUS_PUNCT:usize=0;
static mut WORD_INDEX:u64=0;
static mut TEMP:u64=512;
static mut LOADED:bool=false;
unsafe fn blob(kind:u8,mut offset:usize,length:usize,mut out:*mut u8){
 let mut remaining=length;
 while remaining>0 {
  let shard=offset/24000;let inside=offset%24000;let take=core::cmp::min(24000-inside,remaining);
  let mut address=[0u8;20];address[0]=kind;address[16..20].copy_from_slice(&(shard as u32).to_be_bytes());
  let n=account_code(address.as_ptr(),inside+1,take,out);assert!(n==take);
  remaining-=take;offset+=take;out=out.add(take);
 }
}
const CORE_COMPRESSED_BYTES:usize=1434016;
const GROUP_COMPRESSED_BYTES:usize=45928;
const WORD_COMPRESSED_BYTES:usize=3073668;
const PUNCT_COMPRESSED_BYTES:usize=1963;

// Lossless physical storage only. Decodes exact signed i16 rows directly into
// the independently proven three-lane signed21 compute layout in linear memory.
static mut READ_BUFFER:[u8;24000]=[0;24000];
static mut ROW_PAYLOAD:[u8;768]=[0;768];
static mut WORD_OFFSETS:[u32;129]=[0;129];
struct BitStream { kind:u8, cursor:usize, end:usize, pos:usize, have:usize }
impl BitStream {
 unsafe fn new(kind:u8,start:usize,length:usize)->Self {
  Self{kind,cursor:start,end:start.checked_add(length).unwrap(),pos:0,have:0}
 }
 #[inline] unsafe fn byte(&mut self)->u8 {
  if self.pos==self.have {
   assert!(self.cursor<self.end);
   self.have=core::cmp::min(24000,self.end-self.cursor);self.pos=0;
   blob(self.kind,self.cursor,self.have,READ_BUFFER.as_mut_ptr());
  }
  let value=READ_BUFFER[self.pos];self.pos+=1;self.cursor+=1;value
 }
 unsafe fn take(&mut self,length:usize)->*const u8 {
  assert!(length<=768 && self.cursor.checked_add(length).unwrap()<=self.end);
  if self.have-self.pos>=length {
   let pointer=READ_BUFFER.as_ptr().add(self.pos);self.pos+=length;self.cursor+=length;pointer
  } else {
   for i in 0..length {ROW_PAYLOAD[i]=self.byte();}ROW_PAYLOAD.as_ptr()
  }
 }
 unsafe fn u32(&mut self)->u32 {u32::from_le_bytes([self.byte(),self.byte(),self.byte(),self.byte()])}
 unsafe fn magic(&mut self,expected:&[u8;4]) {for i in 0..4 {assert!(self.byte()==expected[i]);}}
 unsafe fn finish(&self) {assert!(self.cursor==self.end);}
}
#[inline(always)] unsafe fn delta<const B:usize>(data:*const u8,index:usize)->i32 {
 let bit=index*B;let at=bit>>3;let shift=bit&7;
 let mut value=*data.add(at) as u32;
 if shift+B>8 {value|=(*data.add(at+1) as u32)<<8;}
 if shift+B>16 {value|=(*data.add(at+2) as u32)<<16;}
 ((value>>shift)&((1u32<<B)-1)) as i32
}
unsafe fn decode_values<const B:usize>(data:*const u8,min:i32,out:*mut u8){
 for group in 0..128 {
  let a=(min+delta::<B>(data,group*3)) as i64;
  let b=(min+delta::<B>(data,group*3+1)) as i64;
  let c=(min+delta::<B>(data,group*3+2)) as i64;
  assert!((-32768..=32767).contains(&a) && (-32768..=32767).contains(&b) && (-32768..=32767).contains(&c));
  assert!(a.abs()+b.abs()+c.abs()<1024);
  let packed=(a<<42).wrapping_add(b<<21).wrapping_add(c);
  core::ptr::write_unaligned(out.add(group*8).cast::<i64>(),packed.to_le());
 }
}
unsafe fn decode_row(stream:&mut BitStream,out:*mut u8,with_bias:bool) {
 let min=i16::from_le_bytes([stream.byte(),stream.byte()]) as i32;
 let bits=stream.byte() as usize;assert!(bits<=16);
 let bias=if with_bias{stream.u32()}else{0};
 let payload=stream.take(bits*48);
 match bits {
  7=>decode_values::<7>(payload,min,out),
  8=>decode_values::<8>(payload,min,out),
  9=>decode_values::<9>(payload,min,out),
  _=>{
   let mask=(1u64<<bits)-1;let mut accumulator=0u64;let mut available=0usize;let mut at=0;
   for group in 0..128 {
    let mut values=[0i64;3];
    for j in 0..3 {
     while available<bits {accumulator|=(*payload.add(at) as u64)<<available;available+=8;at+=1;}
     let value=min+(accumulator&mask) as i32;accumulator>>=bits;available-=bits;
     assert!((-32768..=32767).contains(&value));values[j]=value as i64;
    }
    assert!(values[0].abs()+values[1].abs()+values[2].abs()<1024);
    let packed=(values[0]<<42).wrapping_add(values[1]<<21).wrapping_add(values[2]);
    core::ptr::write_unaligned(out.add(group*8).cast::<i64>(),packed.to_le());
   }
   assert!(available==0 && accumulator==0 && at==bits*48);
  }
 }
 if with_bias {core::ptr::write_unaligned(out.add(1024).cast::<u32>(),bias.to_le());}
}
unsafe fn load_core(){
 let mut stream=BitStream::new(1,0,CORE_COMPRESSED_BYTES);
 stream.magic(b"N0C1");assert!(stream.u32()==3456);assert!(stream.u32()==16128);assert!(stream.u32()==0);
 for row in 0..3456 {decode_row(&mut stream,CORE.as_mut_ptr().add(row*1024),false);}
 for i in 0..16128 {CORE[CORE_MATRIX+i]=stream.byte();}stream.finish();
}
unsafe fn load_heads(kind:u8,size:usize,out:*mut u8,rows:usize){
 let mut stream=BitStream::new(kind,0,size);stream.magic(b"N0H1");assert!(stream.u32() as usize==rows);
 for row in 0..rows {decode_row(&mut stream,out.add(row*ROW),true);}stream.finish();
}
unsafe fn load_word_offsets(){
 let mut stream=BitStream::new(3,0,532);stream.magic(b"N0W1");assert!(stream.u32()==128);assert!(stream.u32()==64);assert!(stream.u32()==0);
 for i in 0..129 {WORD_OFFSETS[i]=stream.u32();}
 assert!(WORD_OFFSETS[0]==532 && WORD_OFFSETS[128] as usize==WORD_COMPRESSED_BYTES);
 for i in 0..128 {assert!(WORD_OFFSETS[i]<WORD_OFFSETS[i+1]);}
 stream.finish();
}
unsafe fn load_word_group(group:usize){
 assert!(group<128);let start=WORD_OFFSETS[group] as usize;let end=WORD_OFFSETS[group+1] as usize;
 assert!(start>=532 && start<end && end<=WORD_COMPRESSED_BYTES);
 let mut stream=BitStream::new(3,start,end-start);
 for row in 0..64 {decode_row(&mut stream,HEAD.as_mut_ptr().add(row*ROW),true);}stream.finish();
}
unsafe fn load(){
 if !LOADED {
  load_core();load_heads(2,GROUP_COMPRESSED_BYTES,GROUPS.as_mut_ptr(),128);
  load_heads(4,PUNCT_COMPRESSED_BYTES,PUNCT.as_mut_ptr(),5);load_word_offsets();
  blob(7,0,DELTA.len(),DELTA.as_mut_ptr());blob(8,0,EXP.len(),EXP.as_mut_ptr());LOADED=true;
 }
}
#[inline(always)] unsafe fn le16(p:*const u8)->i64 { i16::from_le(core::ptr::read_unaligned(p.cast::<i16>())) as i64 }
#[inline(always)] unsafe fn le32(p:*const u8)->i64 { i32::from_le(core::ptr::read_unaligned(p.cast::<i32>())) as i64 }
#[inline(always)] unsafe fn be16(p:*const u8)->i64 { i16::from_be(core::ptr::read_unaligned(p.cast::<i16>())) as i64 }
#[inline(always)] unsafe fn be40(p:*const u8)->i64 {let mut v=0i64;for i in 0..5{v=(v<<8)|*p.add(i) as i64;}if v&(1<<39)!=0 {v-(1<<40)}else{v}}
#[inline(always)] unsafe fn prepare(values:*const i16,out:*mut i64){for i in 0..128{*out.add(i)=(*values.add(i*3)as i64).wrapping_add((*values.add(i*3+1)as i64)<<21).wrapping_add((*values.add(i*3+2)as i64)<<42);}}
#[inline(always)] unsafe fn dot(weights:*const u8,values:*const i16)->i64 {
 let packed=if values==STATE.as_ptr(){PACK_OLD1.as_ptr()}else if values==STATE.as_ptr().add(H){PACK_OLD2.as_ptr()}else if values==NEXT.as_ptr(){PACK_NEW1.as_ptr()}else {assert!(values==NEXT.as_ptr().add(H));PACK_NEW2.as_ptr()};
 let mut sum=0i64;for i in 0..128{let w=i64::from_le(core::ptr::read_unaligned(weights.add(i*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(i)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}sum
}
#[inline(always)] unsafe fn recurrent(row:usize,values:*const i16)->i64 {dot(CORE.as_ptr().add(row*1024),values)/1024}
#[inline(always)] unsafe fn sigmoid(x:i64)->i64 {let k=core::cmp::min(256,((x.abs()+32)/64) as usize);let d=u16::from_be(core::ptr::read_unaligned(DELTA.as_ptr().add(k*2).cast::<u16>())) as i64;(32768+if x>=0{d}else{-d}+32)/64}
#[inline(always)] unsafe fn cell(xr:i64,rr:i64,xz:i64,rz:i64,xn:i64,rn:i64,old:i16)->i16 {
 let r=sigmoid(xr+rr);let z=sigmoid(xz+rz);let n=2*sigmoid(2*(xn+r*rn/1024))-1024;
 ((z*(old as i64)+(1024-z)*n)/1024) as i16
}
unsafe fn head_score(bytes:*const u8,row:usize,values:*const i16)->i64 { (dot(bytes.add(row*ROW),values)+le32(bytes.add(row*ROW+1024))*1024)/1024 }
unsafe fn draw(start:usize,count:usize,stage:u64)->usize {
 let mut max=SCORES[start];for i in 1..count {max=core::cmp::max(max,SCORES[start+i]);}
 let mut weights=[0u64;128];let mut total=0u64;
 for i in 0..count {let at=core::cmp::min(256,(((max-SCORES[start+i]) as u64*1024/TEMP+32)/64) as usize);let w=u64::from_be(core::ptr::read_unaligned(EXP.as_ptr().add(at*8).cast::<u64>()));weights[i]=w;total+=w;}
 let mut input=[0u8;96];input[..32].copy_from_slice(&SEED);input[56..64].copy_from_slice(&WORD_INDEX.to_be_bytes());input[88..96].copy_from_slice(&stage.to_be_bytes());
 let mut hash=[0u8;32];native_keccak256(input.as_ptr(),96,hash.as_mut_ptr());let mut d=0u64;for byte in hash {d=(d*256+byte as u64)%total;}
 for i in 0..count {if d<weights[i]{return i;}d-=weights[i];}panic!()
}
unsafe fn step_internal()->u32 {
 load();assert!(PREVIOUS<=8192 && PREVIOUS_PUNCT<=4 && TEMP>=64 && TEMP<=4096);
 for x in STATE {assert!((-1024..=1024).contains(&x));}for x in FEATURES {assert!((-4096..=4096).contains(&x));}
 blob(5,PREVIOUS*5760,5760,ROW_TOKEN.as_mut_ptr());blob(6,PREVIOUS_PUNCT*5760,5760,ROW_PUNCT.as_mut_ptr());
 let old1=STATE.as_ptr();let old2=STATE.as_ptr().add(H);prepare(old1,PACK_OLD1.as_mut_ptr());prepare(old2,PACK_OLD2.as_mut_ptr());
 for i in 0..H {
  let mut x=[0i64;3];
  for gate in 0..3 {let k=gate*H+i;let mut feature_sum=0;for j in 0..6 {feature_sum+=be16(CORE.as_ptr().add(CORE_MATRIX+(k*6+j)*2))*FEATURES[j] as i64;}
   x[gate]=(be40(ROW_TOKEN.as_ptr().add(k*5))+be40(ROW_PUNCT.as_ptr().add(k*5))+feature_sum)/1024;}
  NEXT[i]=cell(x[0],recurrent(i,old1),x[1],recurrent(H+i,old1),x[2],recurrent(H*2+i,old1),STATE[i]);
 }
 prepare(NEXT.as_ptr(),PACK_NEW1.as_mut_ptr());
 for i in 0..H {
  let x=NEXT.as_ptr();let mut inputs=[0i64;3];for gate in 0..3 {inputs[gate]=(dot(CORE.as_ptr().add((H*3+gate*H+i)*1024),x)+be16(CORE.as_ptr().add(CORE_MATRIX+(6912+gate*H+i)*2))*1024)/1024;}
  NEXT[H+i]=cell(inputs[0],recurrent(H*6+i,old2),inputs[1],recurrent(H*7+i,old2),inputs[2],recurrent(H*8+i,old2),STATE[H+i]);
 }
 let hidden=NEXT.as_ptr().add(H);prepare(hidden,PACK_NEW2.as_mut_ptr());
 for i in 0..128 {SCORES[i]=head_score(GROUPS.as_ptr(),i,hidden);}
 let group=draw(0,128,0);load_word_group(group);
 for i in 0..64 {SCORES[128+i]=head_score(HEAD.as_ptr(),i,hidden);}
 let token=group*64+draw(128,64,1);let mut wordpunct=[0u8;10];blob(9,token*10,10,wordpunct.as_mut_ptr());
 for i in 0..5 {SCORES[192+i]=(dot(PUNCT.as_ptr().add(i*ROW),hidden)+(le32(PUNCT.as_ptr().add(i*ROW+1024))+le16(wordpunct.as_ptr().add(i*2)))*1024)/1024;}
 let punct=draw(192,5,2);STATE.copy_from_slice(&NEXT);PREVIOUS=token;PREVIOUS_PUNCT=punct;WORD_INDEX+=1;
 token as u32|((punct as u32)<<16)
}
#[no_mangle] pub unsafe extern "C" fn reset(seed:u32,temp:u32,f0:i32,f1:i32,f2:i32,f3:i32,f4:i32,f5:i32){
 assert!((64..=4096).contains(&temp));STATE.fill(0);NEXT.fill(0);SEED.fill(0);SEED[28..32].copy_from_slice(&seed.to_be_bytes());TEMP=temp as u64;FEATURES=[f0,f1,f2,f3,f4,f5];PREVIOUS=8192;PREVIOUS_PUNCT=0;WORD_INDEX=0;
 // Local instance reused by the harness: reset cache so each sentence rereads code like a new transaction.
 LOADED=false;
}
#[no_mangle] pub unsafe extern "C" fn step()->u32 {step_internal()}
#[no_mangle] pub unsafe extern "C" fn sentence(max:u32)->u32 {assert!(max>0&&max<=64);for i in 0..max {let token=step_internal();RESULT[i as usize]=token;if token>>16>=2{return i+1;}}0}
#[no_mangle] pub unsafe extern "C" fn state_ptr()->*const i16 {STATE.as_ptr()}
#[no_mangle] pub unsafe extern "C" fn scores_ptr()->*const i64 {SCORES.as_ptr()}
#[no_mangle] pub unsafe extern "C" fn result_ptr()->*const u32 {RESULT.as_ptr()}

// Fixed-seed benchmark entrypoint for an isolated official Stylus meter.
// This is not a production ABI or an on-chain catalog configuration.
#[cfg(feature="meter-entrypoint")]
#[link(wasm_import_module="vm_hooks")]
extern "C" {
 fn pay_for_memory_grow(pages:u16);
 fn write_result(data:*const u8,length:usize);
 fn msg_reentrant()->u32;
}
#[cfg(feature="meter-entrypoint")]
#[no_mangle] pub unsafe extern "C" fn user_entrypoint(args_len:u32)->u32 {
 if args_len!=0 || msg_reentrant()!=0 {return 1;}
 pay_for_memory_grow(0);
 reset(42,512,0,0,0,0,1024,1024);
 let count=sentence(32);
 if count==0 {return 1;}
 write_result(RESULT.as_ptr().cast::<u8>(),count as usize*4);
 0
}
