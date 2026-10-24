from pathlib import Path
P=Path(__file__).parent;p=P/'wasm/src/lib.rs';s=p.read_text();(P/'loader-generic.rs').write_text(s)
s=s.replace('static mut READ_BUFFER:[u8;24000]=[0;24000];','static mut READ_BUFFER:[u8;24000]=[0;24000];\nstatic mut ROW_PAYLOAD:[u8;768]=[0;768];')
a=s.index(' unsafe fn u32(&mut self)')
s=s[:a]+''' unsafe fn take(&mut self,length:usize)->*const u8 {
  assert!(length<=768 && self.cursor.checked_add(length).unwrap()<=self.end);
  if self.have-self.pos>=length {
   let pointer=READ_BUFFER.as_ptr().add(self.pos);self.pos+=length;self.cursor+=length;pointer
  } else {
   for i in 0..length {ROW_PAYLOAD[i]=self.byte();}ROW_PAYLOAD.as_ptr()
  }
 }
'''+s[a:]
a=s.index('unsafe fn decode_row(');b=s.index('unsafe fn load_core()',a)
s=s[:a]+r'''#[inline(always)] unsafe fn delta<const B:usize>(data:*const u8,index:usize)->i32 {
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
'''+s[b:]
p.write_text(s)
