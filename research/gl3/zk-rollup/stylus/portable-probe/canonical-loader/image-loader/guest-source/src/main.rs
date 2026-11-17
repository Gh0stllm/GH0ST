#![no_main]
mod c_allocator;
use prover::Machine;
use sha2::{Digest,Sha256};
sp1_zkvm::entrypoint!(main);
pub fn main() {
 const IMAGE:&[u8]=include_bytes!("/root/gl3-base-launch/machines/0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97/machine.v2.wavm.br");
 println!("cycle-tracker-start: gl3-machine-image-sha");
 assert_eq!(hex::encode(Sha256::digest(IMAGE)),"791073b628dee37ed5faccb43841dc317dc24e21bd0bb0b7d38c08e652cd78a5");
 println!("cycle-tracker-end: gl3-machine-image-sha");
 println!("cycle-tracker-start: gl3-canonical-image-load");
 let machine=Machine::new_from_wavm_bytes(IMAGE).unwrap();
 println!("cycle-tracker-end: gl3-canonical-image-load");
 assert_eq!(hex::encode(machine.get_modules_root().as_ref()),"c10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97");
 assert_eq!(hex::encode(machine.hash().as_ref()),"e71d0a34e6569b018ad69a561e5412d137b7092fc6d6e71172dcb8f5a99e8a4e");
 sp1_zkvm::io::commit_slice(b"GL3/WAVM/PORTABILITY/1");
 sp1_zkvm::io::commit_slice(machine.get_modules_root().as_ref());
 sp1_zkvm::io::commit_slice(machine.hash().as_ref());
}
