use std::{env,fs};
use wasm_encoder::reencode::{Reencode,RoundtripReencoder};
fn main(){let args:Vec<String>=env::args().collect();let bytes=fs::read(&args[1]).unwrap();let mut out=wasm_encoder::Module::new();RoundtripReencoder.parse_core_module(&mut out,wasmparser::Parser::new(0),&bytes).unwrap();fs::write(&args[2],out.finish()).unwrap();}
