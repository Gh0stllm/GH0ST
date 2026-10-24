from pathlib import Path
import json
P=Path(__file__).parent;V=P.parent.parent;src=V/'stylus/wasm-packed3'
O=P/'wasm';(O/'src').mkdir(parents=True,exist_ok=True)
meta=json.loads((P/'model/manifest.json').read_text());sizes={k:meta['artifacts'][k+'.bin']['bytes']for k in ['core','groups','words','punct']}
s=(src/'src/lib.rs').read_text()
a=s.index('unsafe fn load(){');b=s.index('#[inline(always)] unsafe fn le16',a)
loader=r'''
// Lossless physical storage only. Decodes exact signed i16 rows directly into
// the independently proven three-lane signed21 compute layout in linear memory.
static mut READ_BUFFER:[u8;24000]=[0;24000];
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
 unsafe fn u32(&mut self)->u32 {u32::from_le_bytes([self.byte(),self.byte(),self.byte(),self.byte()])}
 unsafe fn magic(&mut self,expected:&[u8;4]) {for i in 0..4 {assert!(self.byte()==expected[i]);}}
 unsafe fn finish(&self) {assert!(self.cursor==self.end);}
}
unsafe fn decode_row(stream:&mut BitStream,out:*mut u8,with_bias:bool) {
 let min=i16::from_le_bytes([stream.byte(),stream.byte()]) as i32;
 let bits=stream.byte() as u32;assert!(bits<=16);
 let bias=if with_bias{stream.u32()}else{0};
 let mask=(1u64<<bits)-1;let mut accumulator=0u64;let mut available=0u32;
 for group in 0..128 {
  let mut values=[0i64;3];
  for j in 0..3 {
   while available<bits {accumulator|=(stream.byte() as u64)<<available;available+=8;}
   let value=min+(accumulator&mask) as i32;accumulator>>=bits;available-=bits;
   assert!((-32768..=32767).contains(&value));values[j]=value as i64;
  }
  // Prevent malformed data from violating signed21 carry assumptions.
  assert!(values[0].abs()+values[1].abs()+values[2].abs()<1024);
  let packed=(values[0]<<42).wrapping_add(values[1]<<21).wrapping_add(values[2]);
  core::ptr::write_unaligned(out.add(group*8).cast::<i64>(),packed.to_le());
 }
 assert!(available==0 && accumulator==0);
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
'''
consts='\n'.join(f'const {name}_COMPRESSED_BYTES:usize={sizes[key]};'for name,key in [('CORE','core'),('GROUP','groups'),('WORD','words'),('PUNCT','punct')])+'\n'
s=s[:a]+consts+loader+s[b:]
s=s.replace('let group=draw(0,128,0);blob(3,group*64*ROW,64*ROW,HEAD.as_mut_ptr());','let group=draw(0,128,0);load_word_group(group);')
(O/'src/lib.rs').write_text(s)
(O/'Cargo.toml').write_text((src/'Cargo.toml').read_text().replace('nova-wasm-packed3','nova-wasm-delta-packed3'))
print('Rust lossless loader generated:',sizes)
