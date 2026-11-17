extern "C" {
    fn syscall_keccak_permute(w: *mut u64);
}

/// Executes the Keccak256 permutation on the given state.
///
/// ### Safety
///
/// The caller must ensure that `state` is valid pointer to data that is aligned along a four
/// byte boundary.
///
/// As this module is only active the with `target = zkvm`, this is always true.
#[inline]
pub fn keccakf(state: &mut [u64; 25]) {
    unsafe {
        syscall_keccak_permute(state.as_mut_ptr());
    }
}
