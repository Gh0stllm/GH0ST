#[cfg(feature = "export-abi")]
fn main() {
    stylus_sdk::abi::export::print_license_and_pragma("MIT", "pragma solidity ^0.8.23;");
    stylus_sdk::abi::export::print_from_args::<lfm_int4_stylus::Int4Kernel>();
}

#[cfg(not(feature = "export-abi"))]
fn main() {}
