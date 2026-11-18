//! Build an immutable archive for exact resume pages and their proof nodes.
//! This is an offline data conversion. It does not execute the guest.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::Path;

use gl3_stockfish_stylus::checkpoint_tree::{Digest, Keccak, MAX_MEMORY, MAX_PAGES};
use gl3_stockfish_stylus::memory::PAGE_SIZE;
use gl3_stockfish_stylus::rom::PAYLOAD_BYTES;
use gl3_stockfish_stylus::witness_wire::zero_subtrees;
use serde_json::json;
use sha2::{Digest as _, Sha256};
use tiny_keccak::{Hasher, Keccak as TinyKeccak};

const OMITTED: u32 = u32::MAX;
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

struct Hash;

impl Keccak for Hash {
    fn digest(&mut self, input: &[u8]) -> Digest {
        let mut hash = TinyKeccak::v256();
        hash.update(input);
        let mut out = [0; 32];
        hash.finalize(&mut out);
        out
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn put(out: &mut impl Write, cursor: &mut u32, bytes: &[u8]) -> Result<u32> {
    let offset = *cursor;
    *cursor = cursor
        .checked_add(bytes.len() as u32)
        .ok_or("Archive exceeds the wire offset space")?;
    out.write_all(bytes)?;
    Ok(offset)
}

fn pack(input: &Path, expected: &str, output: &Path) -> Result<()> {
    let source = File::open(input)?;
    let length = usize::try_from(source.metadata()?.len())?;
    if length == 0 || length > MAX_MEMORY || length % 65_536 != 0 {
        return Err("Use an exact Wasm memory image whose size is a multiple of 64 KiB".into());
    }
    let mut reader = BufReader::new(source);
    let mut hash = Sha256::new();
    std::io::copy(&mut reader, &mut hash)?;
    let image_sha = hex(&hash.finalize());
    if image_sha != expected {
        return Err("Memory image SHA-256 differs from the supplied pin".into());
    }
    let mut reader = BufReader::new(File::open(input)?);
    let zeros = zero_subtrees(&mut Hash);
    let leaves = MAX_PAGES.next_power_of_two();
    let mut tree = vec![zeros[0]; 2 * leaves];
    let mut image_hash = Sha256::new();
    let mut cursor = 0u32;
    let mut page_offsets = vec![OMITTED; length / PAGE_SIZE];
    let mut unique = HashMap::new();
    let mut committed_pages = 0usize;

    fs::create_dir(output)?;
    let mut archive = BufWriter::new(File::create_new(output.join("archive.bin"))?);
    let mut payload = [0; PAGE_SIZE + 1];
    for (i, offset) in page_offsets.iter_mut().enumerate() {
        reader.read_exact(&mut payload[1..])?;
        image_hash.update(&payload[1..]);
        if payload[1..].iter().all(|&byte| byte == 0) {
            continue;
        }
        let leaf = Hash.digest(&payload);
        let location = if let Some(&position) = unique.get(&leaf) {
            position
        } else {
            let position = put(&mut archive, &mut cursor, &payload[1..])?;
            unique.insert(leaf, position);
            position
        };
        *offset = location;
        tree[leaves + i] = leaf;
        committed_pages += 1;
    }
    if hex(&image_hash.finalize()) != image_sha {
        return Err("Input changed during archive conversion".into());
    }
    let pages_bytes = cursor;
    let mut parent = [1; 65];
    for i in (1..leaves).rev() {
        parent[1..33].copy_from_slice(&tree[i * 2]);
        parent[33..65].copy_from_slice(&tree[i * 2 + 1]);
        tree[i] = Hash.digest(&parent);
    }
    let mut map = BufWriter::new(File::create_new(output.join("offsets.bin"))?);
    for offset in &page_offsets {
        map.write_all(&offset.to_be_bytes())?;
    }
    let mut existing_nodes: HashMap<Digest, u32> = HashMap::new();
    for (i, node) in tree.iter().enumerate().skip(1) {
        let log_width = i.ilog2() as usize;
        let level = (leaves.ilog2() as usize) - log_width;
        let offset = if node == &zeros[level] {
            OMITTED
        } else if let Some(&prior) = existing_nodes.get(node) {
            prior
        } else {
            let position = put(&mut archive, &mut cursor, node)?;
            existing_nodes.insert(*node, position);
            position
        };
        map.write_all(&offset.to_be_bytes())?;
    }
    archive.flush()?;
    map.flush()?;
    let report = json!({
        "schema": "gh0st.gl3.stylus.archive.v1",
        "imageSHA256": image_sha,
        "memoryRoot": hex(&tree[1]),
        "memoryBytes": length,
        "materializedPages": committed_pages,
        "distinctPages": unique.len(),
        "archiveBytes": cursor,
        "archivePageBytes": pages_bytes,
        "archiveCells": (cursor as usize).div_ceil(PAYLOAD_BYTES),
        "offsetRows": page_offsets.len() + tree.len() - 1,
        "offsetLayout": "Big-endian u32 for each initialized page, then binary heap nodes starting at one. 0xffffffff denotes a zero page or zero subtree.",
    });
    let bytes = serde_json::to_vec_pretty(&report)?;
    fs::write(output.join("manifest.json"), &bytes)?;
    println!("{report}");
    Ok(())
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 3 {
        return Err("Pass MEMORY_IMAGE SHA256 NEW_OUTPUT_DIR".into());
    }
    pack(
        Path::new(&args[0]),
        args[1].to_str().ok_or("Invalid SHA-256 text")?,
        Path::new(&args[2]),
    )
}
