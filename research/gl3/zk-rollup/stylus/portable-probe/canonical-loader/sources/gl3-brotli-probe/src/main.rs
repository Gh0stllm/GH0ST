#![no_main]
mod c_allocator;
use brotli::Dictionary;
sp1_zkvm::entrypoint!(main);
pub fn main() {
 let expected=b"GH0ST canonical Brotli allocator test";
 let compressed=hex::decode("0b128047483053542063616e6f6e6963616c2042726f746c6920616c6c6f6361746f72207465737403").unwrap();
 assert_eq!(brotli::decompress(&compressed,Dictionary::Empty).unwrap(),expected);
 assert!(brotli::decompress(&[],Dictionary::Empty).is_err());
 assert!(brotli::decompress(&compressed[..compressed.len()-1],Dictionary::Empty).is_err());
 assert!(brotli::decompress(&[0xff;8],Dictionary::Empty).is_err());
 // Highly compressible output forces the canonical decoder's buffer-growth path.
 let repeated=vec![0x47u8;64*1024];
 let encoded=brotli::compress(&repeated,5,22,Dictionary::Empty).unwrap();
 assert_eq!(brotli::decompress(&encoded,Dictionary::Empty).unwrap(),repeated);
 sp1_zkvm::io::commit_slice(b"GL3/WAVM/PORTABILITY/1");
 sp1_zkvm::io::commit_slice(b"CANONICAL_BROTLI_VALID_TRUNCATED_INVALID_GROWTH_PASSED");
}
