//! Fixed-capacity guest memory for bounded execution. The backend owns page
//! authentication, immutable pages, and transactional persistence.

use core::cmp::min;

pub const PAGE_SIZE: usize = 4 * 1024;
pub const MAX_GUEST_BYTES: u64 = 1 << 32;
pub type Page = [u8; PAGE_SIZE];

pub trait PageBackend {
    type Error;

    /// Return `true` with a full page or `false` for an absent, zero-filled page.
    fn read_page(&mut self, page: u32, bytes: &mut Page) -> Result<bool, Self::Error>;

    /// Persist a full page. A failed write can be retried with the same bytes.
    fn write_page(&mut self, page: u32, bytes: &Page) -> Result<(), Self::Error>;
}

impl<B: PageBackend + ?Sized> PageBackend for &mut B {
    type Error = B::Error;

    fn read_page(&mut self, page: u32, bytes: &mut Page) -> Result<bool, Self::Error> {
        (**self).read_page(page, bytes)
    }

    fn write_page(&mut self, page: u32, bytes: &Page) -> Result<(), Self::Error> {
        (**self).write_page(page, bytes)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum MemoryError<E> {
    InvalidConfiguration,
    OutOfBounds,
    Backend(E),
}

struct Frame {
    page: Option<u32>,
    dirty: bool,
    bytes: Page,
}

impl Frame {
    const EMPTY: Self = Self {
        page: None,
        dirty: false,
        bytes: [0; PAGE_SIZE],
    };

    fn flush<B: PageBackend>(&mut self, backend: &mut B) -> Result<(), MemoryError<B::Error>> {
        if let Some(page) = self.page.filter(|_| self.dirty) {
            backend
                .write_page(page, &self.bytes)
                .map_err(MemoryError::Backend)?;
            self.dirty = false;
        }
        Ok(())
    }
}

/// Direct-mapped resident cache for one guest memory image.
///
/// Eviction can persist dirty pages before `flush`. Use a transactional backend
/// if a failed operation must roll back the whole slice. Call `flush` before
/// committing a successful slice, since dropping the cache discards pages that
/// are still dirty. Keep one cache per transaction or authoritative memory root.
pub struct PagedMemory<B: PageBackend, const RESIDENT: usize> {
    backend: B,
    byte_len: u64,
    frames: [Frame; RESIDENT],
}

impl<B: PageBackend, const RESIDENT: usize> PagedMemory<B, RESIDENT> {
    pub fn new(backend: B, byte_len: u64) -> Result<Self, MemoryError<B::Error>> {
        if RESIDENT == 0 || byte_len > MAX_GUEST_BYTES {
            return Err(MemoryError::InvalidConfiguration);
        }
        Ok(Self {
            backend,
            byte_len,
            frames: [Frame::EMPTY; RESIDENT],
        })
    }

    fn check_span(&self, address: u64, len: usize) -> Result<(), MemoryError<B::Error>> {
        let len = u64::try_from(len).map_err(|_| MemoryError::OutOfBounds)?;
        let end = address.checked_add(len).ok_or(MemoryError::OutOfBounds)?;
        if end > self.byte_len {
            return Err(MemoryError::OutOfBounds);
        }
        Ok(())
    }

    fn frame(&mut self, page: u32) -> Result<&mut Frame, MemoryError<B::Error>> {
        let frame = &mut self.frames[page as usize % RESIDENT];
        if frame.page != Some(page) {
            frame.flush(&mut self.backend)?;
            let mut bytes = [0; PAGE_SIZE];
            let exists = self
                .backend
                .read_page(page, &mut bytes)
                .map_err(MemoryError::Backend)?;
            if !exists {
                bytes.fill(0);
            }
            *frame = Frame {
                page: Some(page),
                dirty: false,
                bytes,
            };
        }
        Ok(frame)
    }

    /// Read a checked byte range, including unaligned and cross-page reads.
    pub fn read(&mut self, address: u32, mut out: &mut [u8]) -> Result<(), MemoryError<B::Error>> {
        self.check_span(u64::from(address), out.len())?;
        let mut cursor = u64::from(address);
        while !out.is_empty() {
            let page = (cursor / PAGE_SIZE as u64) as u32;
            let offset = (cursor % PAGE_SIZE as u64) as usize;
            let count = min(out.len(), PAGE_SIZE - offset);
            let (head, rest) = out.split_at_mut(count);
            head.copy_from_slice(&self.frame(page)?.bytes[offset..offset + count]);
            out = rest;
            cursor += count as u64;
        }
        Ok(())
    }

    /// Store a checked byte range. A bounds failure does not change any pages.
    pub fn write(&mut self, address: u32, mut bytes: &[u8]) -> Result<(), MemoryError<B::Error>> {
        self.check_span(u64::from(address), bytes.len())?;
        let mut cursor = u64::from(address);
        while !bytes.is_empty() {
            let page = (cursor / PAGE_SIZE as u64) as u32;
            let offset = (cursor % PAGE_SIZE as u64) as usize;
            let count = min(bytes.len(), PAGE_SIZE - offset);
            let (head, rest) = bytes.split_at(count);
            let frame = self.frame(page)?;
            frame.bytes[offset..offset + count].copy_from_slice(head);
            frame.dirty = true;
            bytes = rest;
            cursor += count as u64;
        }
        Ok(())
    }

    /// Grow within the guest limit. Pages beyond the old length must have no
    /// saved writes in the backend. A dropped transaction restores both this
    /// length and the backend's writes to the previous checkpoint.
    pub fn grow(&mut self, additional_bytes: u64) -> Result<(), MemoryError<B::Error>> {
        self.byte_len = self
            .byte_len
            .checked_add(additional_bytes)
            .filter(|length| *length <= MAX_GUEST_BYTES)
            .ok_or(MemoryError::OutOfBounds)?;
        Ok(())
    }

    pub fn fill(
        &mut self,
        address: u64,
        value: u8,
        len: usize,
    ) -> Result<(), MemoryError<B::Error>> {
        self.check_span(address, len)?;
        let mut cursor = address;
        let mut remaining = len;
        while remaining != 0 {
            let page = (cursor / PAGE_SIZE as u64) as u32;
            let offset = (cursor % PAGE_SIZE as u64) as usize;
            let count = min(remaining, PAGE_SIZE - offset);
            let frame = self.frame(page)?;
            frame.bytes[offset..offset + count].fill(value);
            frame.dirty = true;
            remaining -= count;
            cursor += count as u64;
        }
        Ok(())
    }

    /// Wasm memory.copy within one image. Bounds are checked before any write,
    /// and the direction preserves reads from an overlapping source span.
    pub fn copy(&mut self, dst: u64, src: u64, len: usize) -> Result<(), MemoryError<B::Error>> {
        self.check_span(dst, len)?;
        self.check_span(src, len)?;
        if dst == src {
            return Ok(());
        }
        let backward = dst > src && dst - src < len as u64;
        let mut scratch = [0; PAGE_SIZE];
        let mut copied = 0;
        while copied < len {
            let count = min(len - copied, PAGE_SIZE);
            let offset = if backward {
                len - copied - count
            } else {
                copied
            } as u64;
            // Each nonempty span starts below 2^32 after the checks above.
            self.read((src + offset) as u32, &mut scratch[..count])?;
            self.write((dst + offset) as u32, &scratch[..count])?;
            copied += count;
        }
        Ok(())
    }

    pub fn flush(&mut self) -> Result<(), MemoryError<B::Error>> {
        for frame in &mut self.frames {
            frame.flush(&mut self.backend)?;
        }
        Ok(())
    }

    fn load<const N: usize>(&mut self, address: u32) -> Result<[u8; N], MemoryError<B::Error>> {
        let mut bytes = [0; N];
        self.read(address, &mut bytes)?;
        Ok(bytes)
    }

    pub fn load_u8(&mut self, address: u32) -> Result<u8, MemoryError<B::Error>> {
        Ok(u8::from_le_bytes(self.load(address)?))
    }

    pub fn load_u16(&mut self, address: u32) -> Result<u16, MemoryError<B::Error>> {
        Ok(u16::from_le_bytes(self.load(address)?))
    }

    pub fn load_u32(&mut self, address: u32) -> Result<u32, MemoryError<B::Error>> {
        Ok(u32::from_le_bytes(self.load(address)?))
    }

    pub fn load_u64(&mut self, address: u32) -> Result<u64, MemoryError<B::Error>> {
        Ok(u64::from_le_bytes(self.load(address)?))
    }

    pub fn store_u8(&mut self, address: u32, value: u8) -> Result<(), MemoryError<B::Error>> {
        self.write(address, &value.to_le_bytes())
    }

    pub fn store_u16(&mut self, address: u32, value: u16) -> Result<(), MemoryError<B::Error>> {
        self.write(address, &value.to_le_bytes())
    }

    pub fn store_u32(&mut self, address: u32, value: u32) -> Result<(), MemoryError<B::Error>> {
        self.write(address, &value.to_le_bytes())
    }

    pub fn store_u64(&mut self, address: u32, value: u64) -> Result<(), MemoryError<B::Error>> {
        self.write(address, &value.to_le_bytes())
    }
}

#[cfg(test)]
mod tests {
    extern crate std;

    use self::std::collections::BTreeMap;
    use super::*;

    #[derive(Default)]
    struct TestBackend {
        pages: BTreeMap<u32, Page>,
        reads: usize,
        writes: usize,
        fail_write: bool,
    }

    impl PageBackend for TestBackend {
        type Error = ();

        fn read_page(&mut self, page: u32, bytes: &mut Page) -> Result<bool, Self::Error> {
            self.reads += 1;
            if let Some(found) = self.pages.get(&page) {
                bytes.copy_from_slice(found);
                return Ok(true);
            }
            bytes.fill(0xff);
            Ok(false)
        }

        fn write_page(&mut self, page: u32, bytes: &Page) -> Result<(), Self::Error> {
            if self.fail_write {
                return Err(());
            }
            self.writes += 1;
            self.pages.insert(page, *bytes);
            Ok(())
        }
    }

    #[test]
    fn scalars_are_little_endian_across_pages() {
        let mut memory = PagedMemory::<_, 2>::new(TestBackend::default(), MAX_GUEST_BYTES).unwrap();
        let address = PAGE_SIZE as u32 - 3;
        memory.store_u64(address, 0x0807_0605_0403_0201).unwrap();
        assert_eq!(memory.load_u16(address + 2), Ok(0x0403));
        assert_eq!(memory.load_u32(address + 1), Ok(0x0504_0302));
        assert_eq!(memory.load_u64(address), Ok(0x0807_0605_0403_0201));
        memory.store_u32(address + 1, 0x4433_2211).unwrap();
        memory.store_u16(address + 2, 0x6655).unwrap();
        memory.store_u8(address, 0x88).unwrap();
        let mut out = [0; 8];
        memory.read(address, &mut out).unwrap();
        assert_eq!(out, [0x88, 0x11, 0x55, 0x66, 0x44, 6, 7, 8]);
        assert_eq!(memory.backend.reads, 2);
    }

    #[test]
    fn eviction_and_flush_restore_a_range_in_a_cold_cache() {
        let mut backend = TestBackend::default();
        let input = [0x69; PAGE_SIZE + 14];
        let address = PAGE_SIZE as u32 - 7;
        let length = 3 * PAGE_SIZE as u64;
        {
            let mut memory = PagedMemory::<_, 1>::new(&mut backend, length).unwrap();
            memory.write(address, &input).unwrap();
            memory.flush().unwrap();
            memory.flush().unwrap();
        }
        assert_eq!(backend.writes, 3);
        let mut memory = PagedMemory::<_, 1>::new(&mut backend, length).unwrap();
        let mut out = [0; PAGE_SIZE + 14];
        memory.read(address, &mut out).unwrap();
        assert_eq!(out, input);
        assert_eq!(memory.load_u8(address - 1), Ok(0));
        assert_eq!(memory.load_u8(address + input.len() as u32), Ok(0));
        memory.flush().unwrap();
        assert_eq!(backend.writes, 3);
    }

    #[test]
    fn guards_reject_the_entire_span_before_loading_or_storing() {
        assert!(matches!(
            PagedMemory::<_, 0>::new(TestBackend::default(), 0),
            Err(MemoryError::InvalidConfiguration)
        ));
        assert!(matches!(
            PagedMemory::<_, 1>::new(TestBackend::default(), MAX_GUEST_BYTES + 1),
            Err(MemoryError::InvalidConfiguration)
        ));
        let mut memory = PagedMemory::<_, 1>::new(TestBackend::default(), MAX_GUEST_BYTES).unwrap();
        assert_eq!(
            memory.store_u16(u32::MAX, 0xffff),
            Err(MemoryError::OutOfBounds)
        );
        let mut out = [7; 2];
        assert_eq!(
            memory.read(u32::MAX, &mut out),
            Err(MemoryError::OutOfBounds)
        );
        assert_eq!(out, [7; 2]);
        assert_eq!(memory.backend.reads, 0);
        assert_eq!(memory.backend.writes, 0);
        assert_eq!(memory.load_u8(u32::MAX), Ok(0));
        memory.store_u8(u32::MAX, 42).unwrap();
        assert_eq!(memory.load_u8(u32::MAX), Ok(42));
        let mut short = PagedMemory::<_, 1>::new(TestBackend::default(), 0).unwrap();
        assert_eq!(short.read(0, &mut []), Ok(()));
        assert_eq!(short.read(1, &mut []), Err(MemoryError::OutOfBounds));
    }

    #[test]
    fn failed_eviction_preserves_dirty_bytes_and_can_be_retried() {
        let mut memory = PagedMemory::<_, 1>::new(TestBackend::default(), MAX_GUEST_BYTES).unwrap();
        memory.store_u8(0, 77).unwrap();
        memory.backend.fail_write = true;
        assert_eq!(
            memory.load_u8(PAGE_SIZE as u32),
            Err(MemoryError::Backend(()))
        );
        assert_eq!(memory.load_u8(0), Ok(77));
        assert_eq!(memory.backend.reads, 1);
        memory.backend.fail_write = false;
        assert_eq!(memory.load_u8(PAGE_SIZE as u32), Ok(0));
        assert_eq!(memory.backend.pages.get(&0).unwrap()[0], 77);
        assert_eq!(memory.backend.writes, 1);
    }

    #[test]
    fn bulk_copy_preserves_overlaps_with_eviction() {
        const SIZE: usize = 3 * PAGE_SIZE;
        let mut reference = [0u8; SIZE];
        for (address, byte) in reference.iter_mut().enumerate() {
            *byte = (address % 251) as u8;
        }
        let mut memory = PagedMemory::<_, 1>::new(TestBackend::default(), SIZE as u64).unwrap();
        memory.write(0, &reference).unwrap();
        reference.copy_within(0..2 * PAGE_SIZE + 1, 137);
        memory.copy(137, 0, 2 * PAGE_SIZE + 1).unwrap();
        reference.copy_within(29..2 * PAGE_SIZE + 29, 0);
        memory.copy(0, 29, 2 * PAGE_SIZE).unwrap();
        reference[PAGE_SIZE - 6..PAGE_SIZE + 5].fill(199);
        memory.fill(PAGE_SIZE as u64 - 6, 199, 11).unwrap();
        let mut result = [0; SIZE];
        memory.read(0, &mut result).unwrap();
        assert_eq!(result, reference);
    }

    #[test]
    fn bulk_bounds_include_zero_length_at_the_end_of_wasm32() {
        let mut memory =
            PagedMemory::<_, 1>::new(TestBackend::default(), MAX_GUEST_BYTES - 2).unwrap();
        assert_eq!(memory.grow(3), Err(MemoryError::OutOfBounds));
        assert_eq!(memory.load_u8(u32::MAX - 1), Err(MemoryError::OutOfBounds));
        memory.grow(2).unwrap();
        assert_eq!(memory.load_u8(u32::MAX), Ok(0));
        assert_eq!(memory.fill(MAX_GUEST_BYTES, 9, 0), Ok(()));
        assert_eq!(memory.copy(MAX_GUEST_BYTES, MAX_GUEST_BYTES, 0), Ok(()));
        assert_eq!(
            memory.fill(MAX_GUEST_BYTES, 9, 1),
            Err(MemoryError::OutOfBounds)
        );
        assert_eq!(
            memory.copy(0, MAX_GUEST_BYTES, 1),
            Err(MemoryError::OutOfBounds)
        );
        assert_eq!(memory.load_u8(0), Ok(0));
    }
}
