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
unsafe fn load(){
 if !LOADED {
  blob(1,0,CORE.len(),CORE.as_mut_ptr());blob(2,0,GROUPS.len(),GROUPS.as_mut_ptr());
  blob(4,0,PUNCT.len(),PUNCT.as_mut_ptr());blob(7,0,DELTA.len(),DELTA.as_mut_ptr());
  blob(8,0,EXP.len(),EXP.as_mut_ptr());LOADED=true;
 }
}
#[inline(always)] unsafe fn le16(p:*const u8)->i64 { i16::from_le(core::ptr::read_unaligned(p.cast::<i16>())) as i64 }
#[inline(always)] unsafe fn le32(p:*const u8)->i64 { i32::from_le(core::ptr::read_unaligned(p.cast::<i32>())) as i64 }
#[inline(always)] unsafe fn be16(p:*const u8)->i64 { i16::from_be(core::ptr::read_unaligned(p.cast::<i16>())) as i64 }
#[inline(always)] unsafe fn be40(p:*const u8)->i64 {let mut v=0i64;for i in 0..5{v=(v<<8)|*p.add(i) as i64;}if v&(1<<39)!=0 {v-(1<<40)}else{v}}
#[inline(always)] unsafe fn prepare(values:*const i16,out:*mut i64){for i in 0..128{*out.add(i)=(*values.add(i*3)as i64).wrapping_add((*values.add(i*3+1)as i64)<<21).wrapping_add((*values.add(i*3+2)as i64)<<42);}}
#[inline(always)] unsafe fn dot(weights:*const u8,values:*const i16)->i64 {
 let packed=if values==STATE.as_ptr(){PACK_OLD1.as_ptr()}else if values==STATE.as_ptr().add(H){PACK_OLD2.as_ptr()}else if values==NEXT.as_ptr(){PACK_NEW1.as_ptr()}else {assert!(values==NEXT.as_ptr().add(H));PACK_NEW2.as_ptr()};
 let mut sum=0i64;
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((0)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(0)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((1)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(1)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((2)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(2)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((3)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(3)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((4)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(4)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((5)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(5)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((6)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(6)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((7)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(7)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((8)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(8)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((9)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(9)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((10)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(10)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((11)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(11)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((12)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(12)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((13)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(13)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((14)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(14)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((15)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(15)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((16)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(16)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((17)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(17)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((18)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(18)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((19)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(19)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((20)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(20)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((21)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(21)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((22)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(22)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((23)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(23)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((24)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(24)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((25)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(25)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((26)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(26)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((27)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(27)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((28)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(28)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((29)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(29)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((30)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(30)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((31)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(31)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((32)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(32)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((33)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(33)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((34)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(34)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((35)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(35)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((36)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(36)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((37)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(37)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((38)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(38)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((39)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(39)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((40)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(40)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((41)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(41)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((42)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(42)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((43)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(43)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((44)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(44)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((45)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(45)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((46)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(46)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((47)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(47)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((48)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(48)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((49)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(49)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((50)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(50)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((51)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(51)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((52)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(52)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((53)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(53)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((54)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(54)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((55)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(55)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((56)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(56)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((57)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(57)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((58)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(58)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((59)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(59)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((60)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(60)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((61)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(61)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((62)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(62)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((63)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(63)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((64)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(64)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((65)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(65)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((66)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(66)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((67)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(67)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((68)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(68)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((69)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(69)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((70)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(70)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((71)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(71)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((72)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(72)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((73)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(73)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((74)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(74)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((75)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(75)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((76)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(76)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((77)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(77)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((78)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(78)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((79)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(79)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((80)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(80)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((81)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(81)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((82)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(82)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((83)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(83)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((84)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(84)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((85)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(85)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((86)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(86)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((87)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(87)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((88)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(88)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((89)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(89)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((90)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(90)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((91)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(91)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((92)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(92)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((93)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(93)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((94)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(94)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((95)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(95)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((96)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(96)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((97)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(97)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((98)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(98)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((99)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(99)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((100)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(100)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((101)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(101)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((102)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(102)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((103)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(103)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((104)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(104)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((105)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(105)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((106)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(106)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((107)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(107)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((108)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(108)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((109)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(109)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((110)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(110)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((111)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(111)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((112)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(112)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((113)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(113)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((114)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(114)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((115)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(115)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((116)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(116)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((117)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(117)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((118)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(118)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((119)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(119)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((120)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(120)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((121)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(121)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((122)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(122)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((123)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(123)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((124)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(124)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((125)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(125)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((126)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(126)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
{let w=i64::from_le(core::ptr::read_unaligned(weights.add((127)*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add(127)).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}
 sum
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
 let group=draw(0,128,0);blob(3,group*64*ROW,64*ROW,HEAD.as_mut_ptr());
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
