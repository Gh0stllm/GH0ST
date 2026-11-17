#![no_std]
//! Exact GL3 statement and registered-data codec. This library is not an STF,
//! an input oracle, a root authenticator or a proof verifier. Its caller must
//! execute the pinned canonical machine and bind actual observed reads.
use tiny_keccak::{Hasher, Keccak};

pub type Hash = [u8; 32];
pub const STATEMENT_BYTES: usize = 736;
const WIRE_CAP: usize = 131_072;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error { Length, Padding, Index, Format, Accumulator, Range }

pub fn keccak(parts: &[&[u8]]) -> Hash {
    let mut hash = Keccak::v256();
    for part in parts { hash.update(part); }
    let mut out = [0; 32]; hash.finalize(&mut out); out
}
fn word(value: u64) -> Hash { let mut out = [0; 32]; out[24..].copy_from_slice(&value.to_be_bytes()); out }
fn read_u64(value: &[u8]) -> Result<u64, Error> {
    if value.len() != 32 { return Err(Error::Length); }
    if value[..24] != [0; 24] { return Err(Error::Padding); }
    Ok(u64::from_be_bytes(value[24..].try_into().unwrap()))
}
fn abi_hash(words: &[Hash]) -> Hash {
    let mut hash = Keccak::v256(); for value in words { hash.update(value); }
    let mut out = [0; 32]; hash.finalize(&mut out); out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GlobalState { pub hashes: [Hash; 4], pub cursor: [u64; 2] }
impl GlobalState {
    fn words(&self) -> [Hash; 6] {
        [self.hashes[0],self.hashes[1],self.hashes[2],self.hashes[3],word(self.cursor[0]),word(self.cursor[1])]
    }
    pub fn equality_hash(&self) -> Hash { abi_hash(&self.words()) }
    fn decode(words: &[Hash]) -> Result<Self, Error> {
        Ok(Self {hashes:words[..4].try_into().map_err(|_|Error::Length)?,cursor:[read_u64(&words[4])?,read_u64(&words[5])?]})
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Range { pub start: u64, pub end: u64, pub commitment: Hash }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Statement {
    pub version: Hash, pub domain: Hash, pub transition_index: u64,
    pub machine_root: Hash, pub execution_profile_hash: Hash,
    pub before: GlobalState, pub after: GlobalState,
    pub sequencer: Range, pub delayed: Range,
}
impl Statement {
    pub fn encode(&self) -> [u8; STATEMENT_BYTES] {
        let mut words = [[0;32];23];
        words[..5].copy_from_slice(&[self.version,self.domain,word(self.transition_index),self.machine_root,self.execution_profile_hash]);
        words[5..11].copy_from_slice(&self.before.words()); words[11..17].copy_from_slice(&self.after.words());
        words[17..].copy_from_slice(&[word(self.sequencer.start),word(self.sequencer.end),self.sequencer.commitment,
            word(self.delayed.start),word(self.delayed.end),self.delayed.commitment]);
        let mut out = [0;STATEMENT_BYTES];
        for (target, value) in out.chunks_exact_mut(32).zip(words) { target.copy_from_slice(&value); } out
    }
    pub fn decode(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.len() != STATEMENT_BYTES { return Err(Error::Length); }
        let mut w = [[0;32];23]; for (target, value) in w.iter_mut().zip(bytes.chunks_exact(32)) { target.copy_from_slice(value); }
        Ok(Self {version:w[0],domain:w[1],transition_index:read_u64(&w[2])?,machine_root:w[3],execution_profile_hash:w[4],
            before:GlobalState::decode(&w[5..11])?,after:GlobalState::decode(&w[11..17])?,
            sequencer:Range{start:read_u64(&w[17])?,end:read_u64(&w[18])?,commitment:w[19]},
            delayed:Range{start:read_u64(&w[20])?,end:read_u64(&w[21])?,commitment:w[22]}})
    }
}

// Private record fields ensure prefix helpers take authenticated wire records,
// rather than arbitrary host-supplied wire/message hashes.
#[derive(Debug, Clone, Copy)]
pub struct SequencerRecord { index:u64, wire_hash:Hash, before:Hash, after:Hash, delayed:Hash, delayed_count:u64 }
#[derive(Debug, Clone, Copy)]
pub struct DelayedRecord { index:u64, wire_hash:Hash, message_hash:Hash, before:Hash, after:Hash }

pub fn authenticate_sequencer(index:u64, wire:&[u8], before:Hash, delayed:Hash, expected_after:Hash) -> Result<SequencerRecord,Error> {
    if wire.len()<40 || wire.len()>WIRE_CAP {return Err(Error::Length);}
    if wire.len()!=40 && wire[40]!=0 {return Err(Error::Format);}
    if index==0 && before!=[0;32] {return Err(Error::Accumulator);}
    let delayed_count=u64::from_be_bytes(wire[32..40].try_into().unwrap());
    if delayed_count==0 && delayed!=[0;32] {return Err(Error::Accumulator);}
    let wire_hash=keccak(&[wire]);let after=keccak(&[&before,&wire_hash,&delayed]);
    if after!=expected_after {return Err(Error::Accumulator);}
    Ok(SequencerRecord{index,wire_hash,before,after,delayed,delayed_count})
}
pub fn authenticate_delayed(index:u64, wire:&[u8], before:Hash, expected_after:Hash) -> Result<DelayedRecord,Error> {
    if wire.len()<113 || wire.len()>WIRE_CAP {return Err(Error::Length);}
    if wire[1..13]!=[0;12] {return Err(Error::Padding);}
    if wire[49..81]!=word(index) {return Err(Error::Index);}
    if index==0 && before!=[0;32] {return Err(Error::Accumulator);}
    let data_hash=keccak(&[&wire[113..]]);
    let message_hash=keccak(&[&wire[..1],&wire[13..33],&wire[33..49],&wire[49..81],&wire[81..113],&data_hash]);
    let after=keccak(&[&before,&message_hash]);if after!=expected_after {return Err(Error::Accumulator);}
    Ok(DelayedRecord{index,wire_hash:keccak(&[wire]),message_hash,before,after})
}
pub fn sequencer_seed(domain:Hash) -> Hash {abi_hash(&[keccak(&[b"GH0ST_GL3_SEQ_RANGE_V1"]),domain])}
pub fn delayed_seed(domain:Hash) -> Hash {abi_hash(&[keccak(&[b"GH0ST_GL3_DELAY_RANGE_V1"]),domain])}

pub fn sequencer_range(domain:Hash,start:u64,end:u64,before_prefix:Hash,records:&[SequencerRecord]) -> Result<Range,Error> {
    if end.checked_sub(start)!=Some(records.len() as u64) || (start==0 && before_prefix!=sequencer_seed(domain)) {return Err(Error::Range);}
    let mut prefix=before_prefix;let mut previous=None;
    for (offset,r) in records.iter().enumerate() {
        if r.index!=start+offset as u64 || previous.map_or(false,|p|p!=r.before) {return Err(Error::Index);}
        prefix=abi_hash(&[prefix,word(r.index),r.wire_hash,r.before,r.after,word(r.delayed_count),r.delayed]);previous=Some(r.after);
    }
    Ok(Range{start,end,commitment:abi_hash(&[keccak(&[b"GH0ST_GL3_SEQ_RANGE_V1"]),domain,word(start),word(end),before_prefix,prefix])})
}
pub fn delayed_range(domain:Hash,start:u64,end:u64,before_prefix:Hash,records:&[DelayedRecord]) -> Result<Range,Error> {
    if end.checked_sub(start)!=Some(records.len() as u64) || (start==0 && before_prefix!=delayed_seed(domain)) {return Err(Error::Range);}
    let mut prefix=before_prefix;let mut previous=None;
    for (offset,r) in records.iter().enumerate() {
        if r.index!=start+offset as u64 || previous.map_or(false,|p|p!=r.before) {return Err(Error::Index);}
        prefix=abi_hash(&[prefix,word(r.index),r.wire_hash,r.message_hash,r.before,r.after]);previous=Some(r.after);
    }
    Ok(Range{start,end,commitment:abi_hash(&[keccak(&[b"GH0ST_GL3_DELAY_RANGE_V1"]),domain,word(start),word(end),before_prefix,prefix])})
}
