fn main() { let pointer = gh0st_icp_coordinator::get_candid_pointer(); let text = unsafe { std::ffi::CString::from_raw(pointer) }; print!("{}", text.to_str().unwrap()); }
