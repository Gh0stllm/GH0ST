#![no_main]
use std::{path::Path,sync::Arc};
use prover::{Machine,binary,machine::GlobalState,value::Value};
sp1_zkvm::entrypoint!(main);
pub fn main(){
 let wasm=wat::parse_str("(module (func (export \"_start\")) (func (export \"add\") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))").unwrap();
 let bin=binary::parse(&wasm,Path::new("gl3-probe")).unwrap();
 let mut machine=Machine::from_binaries(&[],bin,false,false,false,false,GlobalState::default(),Default::default(),Arc::new(|_,_,_|panic!("unexpected preimage")),None,0).unwrap();
 let root=machine.get_modules_root();let name=machine.main_module_name();let(m,f)=machine.find_module_func(&name,"add").unwrap();machine.jump_into_func(m,f,vec![Value::I32(12),Value::I32(7)]).unwrap();
 machine.step_n(1000).unwrap();assert!(machine.is_halted());assert_eq!(machine.get_final_result().unwrap(),vec![Value::I32(19)]);
 sp1_zkvm::io::commit_slice(b"GL3/WAVM/PORTABILITY/1");sp1_zkvm::io::commit_slice(root.as_ref());sp1_zkvm::io::commit_slice(machine.hash().as_ref());
}
