use std::{path::Path,sync::Arc,time::Instant};
use prover::{Machine,binary,machine::GlobalState,value::Value};
use sha2::{Digest,Sha256};
fn main(){
 let a:Vec<String>=std::env::args().collect();let start=Instant::now();
 if a.len()==2{
  let image=std::fs::read(&a[1]).unwrap();let image_sha=hex::encode(Sha256::digest(&image));
  assert_eq!(image_sha,"791073b628dee37ed5faccb43841dc317dc24e21bd0bb0b7d38c08e652cd78a5");
  let mach=Machine::new_from_wavm(Path::new(&a[1])).unwrap();
  assert_eq!(hex::encode(mach.get_modules_root().as_ref()),"c10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97");
  println!("{}",serde_json::json!({"phase":"canonical official image native authenticated load only","imageSHA256":image_sha,"imageBytes":image.len(),"moduleRoot":hex::encode(mach.get_modules_root().as_ref()),"machineHash":hex::encode(mach.hash().as_ref()),"seconds":start.elapsed().as_secs_f64(),"fullSTFExecuted":false}));return;
 }
 let wasm=wat::parse_str("(module (func (export \"_start\")) (func (export \"add\") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))".replace("\\\"","\"")).unwrap();
 let bin=binary::parse(&wasm,Path::new("gl3-probe")).unwrap();
 let mut machine=Machine::from_binaries(&[],bin,false,false,false,false,GlobalState::default(),Default::default(),Arc::new(|_,_,_|panic!("unexpected preimage")),None,0).unwrap();
 let root=machine.get_modules_root();let name=machine.main_module_name();let(m,f)=machine.find_module_func(&name,"add").unwrap();machine.jump_into_func(m,f,vec![Value::I32(12),Value::I32(7)]).unwrap();
 machine.step_n(1000).unwrap();assert!(machine.is_halted());assert_eq!(machine.get_final_result().unwrap(),vec![Value::I32(19)]);
 println!("{}",serde_json::json!({"phase":"native canonical arithmetic differential reference","moduleRoot":hex::encode(root.as_ref()),"machineHash":hex::encode(machine.hash().as_ref()),"result":19,"seconds":start.elapsed().as_secs_f64()}));
}
