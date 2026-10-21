// SPDX-License-Identifier: MIT
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]

extern crate alloc;

use alloc::vec::Vec;
use alloy_primitives::{Address, B256, I256, U256};
use alloy_sol_types::{sol, SolError, SolValue};
use stylus_sdk::{abi::Bytes, prelude::*, storage::{StorageB256, StorageU256}};

sol! {
    error InvalidDimensions();
    error InvalidDataLength();
    error CounterOverflow();
}

fn dimensions(rows: U256, cols: U256) -> Result<(usize, usize), Vec<u8>> {
    if rows == U256::ZERO || rows > U256::from(8)
        || cols == U256::ZERO || cols > U256::from(1024) {
        return Err(InvalidDimensions {}.abi_encode());
    }
    Ok((rows.to::<usize>(), cols.to::<usize>()))
}

/// Signed packed-int4 matrix x little-endian signed-int16 vector.
/// Integer accumulations only: no rescaling, nonlinearity or complete LFM layer.
pub fn dot(weights: &[u8], activations: &[u8], rows: usize, cols: usize)
    -> Result<Vec<I256>, Vec<u8>> {
    if rows == 0 || rows > 8 || cols == 0 || cols > 1024 {
        return Err(InvalidDimensions {}.abi_encode());
    }
    if weights.len() != (rows * cols + 1) / 2 || activations.len() != cols * 2 {
        return Err(InvalidDataLength {}.abi_encode());
    }
    let mut output = Vec::with_capacity(rows);
    for row in 0..rows {
        let mut sum: i64 = 0;
        for col in 0..cols {
            let index = row * cols + col;
            let nibble = (weights[index / 2] >> (4 * (index & 1))) & 15;
            let weight = ((nibble as i8) << 4) >> 4;
            let value = i16::from_le_bytes([activations[2 * col], activations[2 * col + 1]]);
            // |sum| <= 1024 * 8 * 32768; no i64 overflow is possible.
            sum += (weight as i64) * (value as i64);
        }
        output.push(I256::try_from(sum).expect("bounded int64 fits int256"));
    }
    Ok(output)
}

/// Benchmark storage layout matches the Solidity kernel (hash at slot 0, runs at 1).
/// No production permissions or assets. This is not the complete agent runtime.
#[storage]
#[entrypoint]
pub struct Int4Kernel {
    result_hash: StorageB256,
    runs: StorageU256,
}

#[public]
impl Int4Kernel {
    pub fn dot_calldata(weights: Bytes, activations: Bytes, rows: U256, cols: U256)
        -> Result<Vec<I256>, Vec<u8>> {
        let (rows, cols) = dimensions(rows, cols)?;
        dot(&weights, &activations, rows, cols)
    }

    pub fn dot_from_code(&self, shard: Address, activations: Bytes, rows: U256, cols: U256)
        -> Result<Vec<I256>, Vec<u8>> {
        let (rows, cols) = dimensions(rows, cols)?;
        let expected = (rows * cols + 1) / 2 + 1;
        if self.vm().code_size(shard) != expected {
            return Err(InvalidDataLength {}.abi_encode());
        }
        let code = self.vm().code(shard);
        if code.len() != expected {
            return Err(InvalidDataLength {}.abi_encode());
        }
        dot(&code[1..], &activations, rows, cols)
    }

    pub fn compute_and_store(&mut self, shard: Address, activations: Bytes, rows: U256, cols: U256)
        -> Result<B256, Vec<u8>> {
        let output = self.dot_from_code(shard, activations, rows, cols)?;
        let digest = self.vm().native_keccak256(&(output,).abi_encode_params());
        let next = self.runs.get().checked_add(U256::from(1))
            .ok_or_else(|| CounterOverflow {}.abi_encode())?;
        self.result_hash.set(digest);
        self.runs.set(next);
        Ok(digest)
    }

    pub fn result_hash(&self) -> B256 { self.result_hash.get() }
    pub fn runs(&self) -> U256 { self.runs.get() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use stylus_sdk::testing::TestVM;

    fn fixture() -> serde_json::Value {
        serde_json::from_str(include_str!("../../contract-benchmark/lfm-slice.json")).unwrap()
    }

    fn packed(matrix: &[Vec<i8>], values: &[i16]) -> (Vec<u8>, Vec<u8>) {
        let flat: Vec<_> = matrix.iter().flatten().collect();
        let mut w = Vec::new();
        for pair in flat.chunks(2) {
            let lo = (*pair[0] as u8) & 15;
            let hi = if pair.len() == 2 { (*pair[1] as u8) & 15 } else { 0 };
            w.push(lo | (hi << 4));
        }
        let a = values.iter().flat_map(|v| v.to_le_bytes()).collect();
        (w, a)
    }

    fn check_matrix(matrix: Vec<Vec<i8>>, values: Vec<i16>) {
        let expected: Vec<I256> = matrix.iter().map(|row| {
            let s: i64 = row.iter().zip(&values).map(|(w,x)| (*w as i64)*(*x as i64)).sum();
            I256::try_from(s).unwrap()
        }).collect();
        let (w,a) = packed(&matrix, &values);
        assert_eq!(dot(&w,&a,matrix.len(),values.len()).unwrap(), expected);
        let vm = TestVM::default();
        let addr = Address::with_last_byte(99);
        vm.set_code(addr, [vec![0], w].concat());
        let contract = Int4Kernel::from(&vm);
        assert_eq!(contract.dot_from_code(addr,a.into(),U256::from(matrix.len()),U256::from(values.len())).unwrap(), expected);
    }

    #[test]
    fn signed_extremes() {
        check_matrix(vec![vec![-8,7,-1,0],vec![7,-8,1,0]],vec![-32768,32767,-1,0]);
    }

    #[test]
    fn accumulator_bound() { check_matrix(vec![vec![-8;1024]],vec![-32768;1024]); }

    #[test]
    fn odd_rows_and_column_lengths() {
        check_matrix(vec![vec![-3,2,7],vec![1,-8,4],vec![0,-1,5]],vec![-32768,101,32767]);
    }

    #[test]
    fn deterministic_varied_matrices() {
        let mut seed = 20261020u64;
        for (r,c) in [(1,1),(1,2),(2,3),(3,31),(4,64),(8,1024)] {
            let mut next = || { seed=seed.wrapping_mul(6364136223846793005).wrapping_add(1); seed };
            let matrix = (0..r).map(|_| (0..c).map(|_| ((next() >> 32) % 16) as i8 - 8).collect()).collect();
            let values = (0..c).map(|_| (next() >> 32) as i16).collect();
            check_matrix(matrix,values);
        }
    }

    #[test]
    fn invalid_dimensions_and_lengths() {
        for (r,c) in [(0,1),(9,1),(1,0),(1,1025)] { assert!(dot(&[],&[],r,c).is_err()); }
        assert!(dot(&[], &[0,0], 1,1).is_err());
        assert!(dot(&[0], &[0], 1,1).is_err());
        assert!(dot(&[0,0], &[0,0], 1,1).is_err());
        assert!(dimensions(U256::MAX,U256::from(1)).is_err());
    }

    #[test]
    fn missing_shard_rejected() {
        let vm=TestVM::default(); let c=Int4Kernel::from(&vm);
        assert!(c.dot_from_code(Address::ZERO,vec![0,0].into(),U256::from(1),U256::from(1)).is_err());
    }

    #[test]
    fn real_lfm_slice_matches_and_commitment_persists() {
        let f=fixture();
        let w=hex::decode(f["packed_weights_hex"].as_str().unwrap()).unwrap();
        let a=hex::decode(f["packed_activations_hex"].as_str().unwrap()).unwrap();
        let expected:Vec<I256>=f["expected_integer_outputs"].as_array().unwrap().iter()
            .map(|x| I256::try_from(x.as_i64().unwrap()).unwrap()).collect();
        let vm=TestVM::default(); let addr=Address::with_last_byte(99);
        vm.set_code(addr,[vec![0],w.clone()].concat());
        let mut c=Int4Kernel::from(&vm);
        for rows in [1,2,4] {
            assert_eq!(dot(&w[..rows*512],&a,rows,1024).unwrap(),expected[..rows]);
        }
        assert_eq!(c.dot_from_code(addr,a.clone().into(),U256::from(4),U256::from(1024)).unwrap(),expected);
        let digest=c.compute_and_store(addr,a.clone().into(),U256::from(4),U256::from(1024)).unwrap();
        assert_eq!(hex::encode(digest),"942bf1e07782c6cbd557e7e8c4ed5657b9628a2bd46370b42f20215f01348ecc");
        assert_eq!(c.result_hash(),digest); assert_eq!(c.runs(),U256::from(1));
        assert_eq!(c.compute_and_store(addr,a.into(),U256::from(4),U256::from(1024)).unwrap(),digest);
        assert_eq!(c.runs(),U256::from(2));
    }
}
