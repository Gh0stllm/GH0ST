//! Recover the exact initialized seed from the archived first private block.
//! This walks account-trie proof nodes and hashes the result against the
//! historical runtime commitment. It never instantiates the chess engine.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;

use gl3_stockfish_stylus::checkpoint_tree::MAX_PAGES;
use gl3_stockfish_stylus::memory::{Page, PAGE_SIZE};
use rlp::Rlp;
use sha2::{Digest as _, Sha256};
use tiny_keccak::{Hasher, Keccak};

type Word = [u8; 32];
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

const START_BLOCK: &str = "2fc42fe0046d2b36ddb1daede0cbe355198fced95e30ee0ac8f7b6787ee0917f";
const VM_SHA: &str = "1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc";
const PREFIX: &[u8] = b"\x00GL3S\x01";
const ARBOS_STORAGE: [u8; 20] = [
    0xa4, 0xb0, 0x5f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff,
];

fn hex(word: &Word) -> String {
    word.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn word(s: &str) -> Word {
    std::array::from_fn(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap())
}

fn keccak(parts: &[&[u8]]) -> Word {
    let mut hasher = Keccak::v256();
    for part in parts {
        hasher.update(part);
    }
    let mut out = [0; 32];
    hasher.finalize(&mut out);
    out
}

fn index(bytes: &[u8]) -> Result<HashMap<Word, &[u8]>> {
    let mut remaining = bytes;
    let mut indexed = HashMap::new();
    while !remaining.is_empty() {
        let (size, next) = remaining
            .split_at_checked(8)
            .ok_or("Truncated preimage header")?;
        let count = usize::try_from(u64::from_le_bytes(size.try_into()?))?;
        let (preimage, next) = next.split_at_checked(count).ok_or("Truncated preimage")?;
        let digest = keccak(&[preimage]);
        if indexed
            .insert(digest, preimage)
            .is_some_and(|first| first != preimage)
        {
            return Err("Ambiguous preimage digest".into());
        }
        remaining = next;
    }
    Ok(indexed)
}

fn next_node<'a>(ref_value: Rlp<'a>, db: &HashMap<Word, &'a [u8]>) -> Result<Option<Rlp<'a>>> {
    if ref_value.is_list() {
        return Ok(Some(ref_value));
    }
    let raw = ref_value.data()?;
    if raw.is_empty() {
        return Ok(None);
    }
    let key: Word = raw.try_into()?;
    let bytes = db
        .get(&key)
        .ok_or("Trie proof is missing a required preimage")?;
    Ok(Some(Rlp::new(bytes)))
}

fn account<'a>(db: &HashMap<Word, &'a [u8]>, root: &Word, key: Word) -> Result<Option<Rlp<'a>>> {
    let mut nibble = [0u8; 64];
    for (pair, byte) in nibble.chunks_exact_mut(2).zip(key) {
        pair[0] = byte >> 4;
        pair[1] = byte & 15;
    }
    let mut tail = nibble.as_slice();
    let mut node = Rlp::new(db.get(root).ok_or("State-trie root preimage missing")?);
    loop {
        let child = match node.item_count()? {
            17 => {
                let Some((index, path)) = tail.split_first() else {
                    let value = node.at(16)?.data()?;
                    return Ok((!value.is_empty()).then(|| Rlp::new(value)));
                };
                tail = path;
                node.at(usize::from(*index))?
            }
            2 => {
                let bytes = node.at(0)?.data()?;
                let prefix = *bytes.first().ok_or("Empty hex-prefix path")?;
                let flags = prefix >> 4;
                let odd = flags & 1 != 0;
                if flags > 3 || (!odd && prefix & 15 != 0) {
                    return Err("Invalid hex-prefix path".into());
                }
                let mut path = [0u8; 64];
                let count = 2 * (bytes.len() - 1) + usize::from(odd);
                if count > 64 || (flags < 2 && count == 0) {
                    return Err("Invalid trie path length".into());
                }
                if odd {
                    path[0] = prefix & 15;
                }
                for (pair, &byte) in path[usize::from(odd)..count]
                    .chunks_exact_mut(2)
                    .zip(&bytes[1..])
                {
                    pair[0] = byte >> 4;
                    pair[1] = byte & 15;
                }
                let Some(unmatched) = tail.strip_prefix(&path[..count]) else {
                    return Ok(None);
                };
                tail = unmatched;
                let value = node.at(1)?;
                if flags >= 2 {
                    return Ok(tail
                        .is_empty()
                        .then(|| value.data().map(Rlp::new))
                        .transpose()?);
                }
                value
            }
            _ => return Err("Invalid account-trie node".into()),
        };
        let Some(child) = next_node(child, db)? else {
            return Ok(None);
        };
        node = child;
    }
}

fn seed_meta(
    db: &HashMap<Word, &[u8]>,
    state: &Word,
    namespace: &Word,
) -> Result<serde_json::Value> {
    let state_account =
        account(db, state, keccak(&[&ARBOS_STORAGE]))?.ok_or("ArbOS account is absent")?;
    let root: Word = state_account.at(2)?.data()?.try_into()?;
    let space = keccak(&[&keccak(&[b"GL3_CHESS_SLICE_META_V1"]), namespace]);
    let slot = |i: u8| -> Result<Word> {
        let mut mapped = keccak(&[&space, &[0; 31]]);
        mapped[31] = i;
        let mut out = [0; 32];
        if let Some(value) = account(db, &root, keccak(&[&mapped]))? {
            let bytes = value.data()?;
            if bytes.len() > 32 {
                return Err("Storage slot word too large".into());
            }
            out[32 - bytes.len()..].copy_from_slice(bytes);
        }
        Ok(out)
    };
    let length = usize::try_from(u64::from_be_bytes(slot(0)?[24..].try_into()?))?;
    if !(1..=7000).contains(&length) {
        return Err("Invalid pinned seed metadata length".into());
    }
    let mut out = Vec::with_capacity(length);
    for index in 0..length.div_ceil(32) {
        let data = slot((index + 1) as u8)?;
        let bytes = (length - out.len()).min(32);
        out.extend_from_slice(&data[32 - bytes..]);
    }
    Ok(serde_json::from_slice(&out)?)
}

fn extract(preimages: &[u8], output: &Path) -> Result<()> {
    let indexed = index(preimages)?;
    let block = indexed
        .get(&word(START_BLOCK))
        .ok_or("Pinned start block is absent")?;
    let root: Word = Rlp::new(block).at(3)?.data()?.try_into()?;
    let namespace = keccak(&[b"GL3_CHESS_SLICE_SEED_V1"]);
    let metadata = seed_meta(&indexed, &root, &namespace)?;
    let module: Word = serde_json::from_value(metadata["Module"].clone())?;
    let expected: Word = serde_json::from_value(metadata["Root"].clone())?;
    let memory = usize::try_from(
        metadata["MemoryBytes"]
            .as_u64()
            .ok_or("Missing memory length")?,
    )?;
    if module != word(VM_SHA)
        || metadata["Version"].as_u64() != Some(2)
        || metadata["Deltas"].as_u64() != Some(0)
        || memory == 0
        || memory > MAX_PAGES * PAGE_SIZE
        || memory % 65536 != 0
    {
        return Err("Archived seed identity differs from the exact guest".into());
    }
    let empty = keccak(&[b""]);
    let leaves = MAX_PAGES.next_power_of_two();
    let mut tree = vec![[0u8; 32]; leaves * 2];
    let zero: Page = [0; PAGE_SIZE];
    let mut bodies = Vec::new();
    let mut image_hash = Sha256::new();
    for i in 0..memory / PAGE_SIZE {
        let address = keccak(&[
            b"GL3_CHESS_SLICE_CELL_V1",
            &namespace,
            &(i as u64).to_be_bytes(),
        ]);
        let hashed = keccak(&[&address[12..]]);
        let account = account(&indexed, &root, hashed)?;
        let page = if let Some(account) = account {
            let code: Word = account.at(3)?.data()?.try_into()?;
            if code == empty {
                &zero
            } else {
                let raw = indexed.get(&code).ok_or("Seed bytecode preimage missing")?;
                let content: &Page = raw
                    .strip_prefix(PREFIX)
                    .ok_or("Unexpected seed bytecode prefix")?
                    .try_into()?;
                bodies.push((i, content));
                content
            }
        } else {
            &zero
        };
        image_hash.update(page);
        let mut hash = Sha256::new();
        hash.update(b"GL3_CHESS_VM_PAGE_V1");
        hash.update((i as u64).to_le_bytes());
        hash.update(page);
        tree[leaves + i] = hash.finalize().into();
    }
    for i in (1..leaves).rev() {
        let mut hash = Sha256::new();
        hash.update([1]);
        hash.update(tree[i * 2]);
        hash.update(tree[i * 2 + 1]);
        tree[i] = hash.finalize().into();
    }
    let mut hash = Sha256::new();
    hash.update(b"GL3_CHESS_IMAGE_V1");
    hash.update(word(VM_SHA));
    hash.update(tree[1]);
    hash.update((memory as u64).to_le_bytes());
    let globals = metadata["Globals"]
        .as_array()
        .ok_or("Missing mutable globals")?;
    if globals.len() != 3 {
        return Err("Unexpected mutable globals count".into());
    }
    let mut values = [0u64; 3];
    for (i, (global, name)) in globals
        .iter()
        .zip(["gl3_global_0", "gl3_global_98", "gl3_global_99"])
        .enumerate()
    {
        if global["Name"].as_str() != Some(name) {
            return Err("Unexpected global name or order".into());
        }
        let value = global["Value"].as_u64().ok_or("Missing global value")?;
        values[i] = value;
        hash.update(name.as_bytes());
        hash.update([0]);
        hash.update(value.to_le_bytes());
    }
    let prior: Word = hash.finalize().into();
    if prior != expected {
        return Err(format!("Historical image commitment differs: {}", hex(&prior)).into());
    }

    let mut file = File::create_new(output)?;
    file.set_len(memory as u64)?;
    for (i, bytes) in &bodies {
        file.seek(SeekFrom::Start((i * PAGE_SIZE) as u64))?;
        file.write_all(*bytes)?;
    }
    file.sync_all()?;
    let sha: Word = image_hash.finalize().into();
    println!(
        "Recovered {} bytes, {} on-chain seed pages, historical root {}, image SHA-256 {}",
        memory,
        bodies.len(),
        hex(&prior),
        hex(&sha)
    );
    println!("Retained mutable globals {values:?}");
    Ok(())
}

fn main() -> Result<()> {
    let mut args = std::env::args_os().skip(1);
    let input = args.next().ok_or("Pass PREIMAGES_BIN OUT_SEED_BIN")?;
    let output = args.next().ok_or("Pass PREIMAGES_BIN OUT_SEED_BIN")?;
    if args.next().is_some() {
        return Err("Pass PREIMAGES_BIN OUT_SEED_BIN".into());
    }
    extract(&fs::read(input)?, Path::new(&output))
}
