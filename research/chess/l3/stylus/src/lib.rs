//! Bounded integer tensor kernels using the real Stylus Rust SDK.
//! This is a compatibility contract, not a deployed L3 or complete LLM.
#![cfg_attr(target_arch = "wasm32", no_std)]
extern crate alloc;

pub const MAX_LANES: usize = 256;

pub fn exact_dot(weights: &[i16], activations: &[i16]) -> Result<i64, &'static str> {
    if weights.is_empty() || weights.len() != activations.len() || weights.len() > MAX_LANES {
        return Err("invalid tensor dimensions");
    }
    Ok(weights.iter().zip(activations).map(|(&w, &a)| i64::from(w) * i64::from(a)).sum())
}

pub fn exact_argmax(logits: &[i64]) -> Result<u32, &'static str> {
    if logits.is_empty() || logits.len() > MAX_LANES { return Err("invalid logits length"); }
    let mut best = 0;
    for i in 1..logits.len() { if logits[i] > logits[best] { best = i; } }
    Ok(best as u32)
}

#[cfg(target_arch = "wasm32")]
mod contract {
    use super::*;
    use alloc::{vec, vec::Vec, string::ToString};
    use stylus_sdk::prelude::*;
    sol_storage! {
        #[entrypoint]
        pub struct Gh0stTensorKernel {}
    }

    #[public]
    impl Gh0stTensorKernel {
        pub fn kernel_version(&self) -> u32 { 1 }
        pub fn dot_product(&self, weights: Vec<i16>, activations: Vec<i16>) -> Result<i64, Vec<u8>> {
            exact_dot(&weights, &activations).map_err(|e| e.to_string().into_bytes())
        }
        pub fn linear_relu(&self, weights: Vec<i16>, activations: Vec<i16>, bias: i64) -> Result<i64, Vec<u8>> {
            let product = exact_dot(&weights, &activations).map_err(|e| e.to_string().into_bytes())?;
            product.checked_add(bias).map(|v| v.max(0)).ok_or_else(|| b"linear accumulation overflow".to_vec())
        }
        pub fn argmax(&self, logits: Vec<i64>) -> Result<u32, Vec<u8>> {
            exact_argmax(&logits).map_err(|e| e.to_string().into_bytes())
        }
    }

}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn signed_dot_matches_scalar_reference() {
        assert_eq!(exact_dot(&[-7, 3, 2], &[4, -5, 6]), Ok(-31));
    }
    #[test] fn largest_signed_lanes_do_not_overflow_i64() {
        assert_eq!(exact_dot(&vec![i16::MIN; MAX_LANES], &vec![i16::MIN; MAX_LANES]), Ok(274877906944));
    }
    #[test] fn mismatched_empty_or_oversized_inputs_revert() {
        assert!(exact_dot(&[], &[]).is_err());
        assert!(exact_dot(&[1], &[1, 2]).is_err());
        assert!(exact_dot(&vec![1; 257], &vec![1; 257]).is_err());
    }
    #[test] fn argmax_is_signed_and_ties_choose_lowest_index() {
        assert_eq!(exact_argmax(&[-9, -3, -3, -8]), Ok(1));
        assert_eq!(exact_argmax(&[i64::MIN, i64::MAX]), Ok(1));
        assert!(exact_argmax(&[]).is_err());
    }
}
