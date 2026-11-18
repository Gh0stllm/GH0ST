use gl3_stockfish_stylus::{
    checkpoint_tree::{Digest, Keccak},
    interpreter::rom_code::RomCode,
    rom::{Address, BytecodeRom, CodeHash, CodeHost, Shard, PAYLOAD_BYTES},
};
use std::{fs, path::Path, rc::Rc};
pub struct NativeKeccak;

const CODE: &str = "0f1dc6066d456a17b90b7879558902957e049ff4dc6d39b6de4c90b0fa6ad052";
const FUNCTIONS: &str = "6164b8d04c06a9a6f6f6768dd04e888006901826eae651c2f7b221b55a811e36";
const CONTROLS: &str = "a88fb0e84ef51a8e0b06921c9e60439c124f7781de0540436e19a3e406e0ae8c";
const RUNTIME: &str = "850650446679bb26d5abae9798a33fabe2190c7549211f4f86f5f56cc2eb7d2b";
impl Keccak for NativeKeccak {
    fn digest(&mut self, bytes: &[u8]) -> Digest {
        use tiny_keccak::{Hasher, Keccak};
        let mut output = [0; 32];
        let mut hash = Keccak::v256();
        hash.update(bytes);
        hash.finalize(&mut output);
        output
    }
}

pub fn require_digest(bytes: &[u8], expected: &str) {
    let actual: String = NativeKeccak
        .digest(bytes)
        .iter()
        .map(|n| format!("{n:02x}"))
        .collect();
    assert_eq!(actual, expected, "Pinned ROM bytes changed");
}

struct FixtureCell {
    bytes: Vec<u8>,
    hash: CodeHash,
}

#[derive(Clone)]
pub struct FixtureHost(Rc<Vec<FixtureCell>>);

impl FixtureHost {
    fn cell(&self, address: &Address) -> Result<&FixtureCell, &'static str> {
        if address[..16] != [0; 16] {
            return Err("Unknown fixture address");
        }
        let index = u32::from_be_bytes(address[16..].try_into().unwrap());
        self.0
            .get(index as usize)
            .ok_or("Missing fixture address")
    }
}

impl CodeHost for FixtureHost {
    type Error = &'static str;

    fn code_hash(&mut self, address: &Address) -> Result<CodeHash, Self::Error> {
        Ok(self.cell(address)?.hash)
    }

    fn copy_code(&mut self, address: &Address, out: &mut [u8]) -> Result<usize, Self::Error> {
        let cell = &self.cell(address)?.bytes;
        let count = out.len().min(cell.len());
        out[..count].copy_from_slice(&cell[..count]);
        Ok(cell.len())
    }
}

fn encoded_cells(directory: &Path, prefix: &str, count: usize) -> Vec<Vec<u8>> {
    (0..count)
        .map(|index| fs::read(directory.join(format!("{prefix}-{index:04}.bin"))).unwrap())
        .collect()
}

fn raw_to_cells(bytes: &[u8]) -> Vec<Vec<u8>> {
    bytes
        .chunks(PAYLOAD_BYTES)
        .map(|payload| {
            let mut cell = Vec::with_capacity(payload.len() + 1);
            cell.push(0);
            cell.extend_from_slice(payload);
            cell
        })
        .collect()
}

fn commit_group(
    host: &mut Vec<FixtureCell>,
    cells: Vec<Vec<u8>>,
    expected: &str,
) -> (Vec<Shard>, u32) {
    let mut payload = Vec::new();
    let mut shards = Vec::new();
    let count = cells.len();
    for (index, cell) in cells.into_iter().enumerate() {
        assert_eq!(cell[0], 0, "ROM cells must start with STOP");
        assert!((2..=PAYLOAD_BYTES + 1).contains(&cell.len()));
        assert!(index + 1 == count || cell.len() == PAYLOAD_BYTES + 1);
        payload.extend_from_slice(&cell[1..]);
        let mut address = [0; 20];
        address[16..].copy_from_slice(&(host.len() as u32).to_be_bytes());
        let code_hash = NativeKeccak.digest(&cell);
        shards.push(Shard { address, code_hash });
        host.push(FixtureCell { bytes: cell, hash: code_hash });
    }
    require_digest(&payload, expected);
    (shards, payload.len() as u32)
}

pub struct PinnedRom {
    host: FixtureHost,
    code: (Vec<Shard>, u32),
    functions: (Vec<Shard>, u32),
    controls: (Vec<Shard>, u32),
    runtime: (Vec<Shard>, u32),
}

impl PinnedRom {
    pub fn load(cells: &Path, control_path: &Path, runtime_path: &Path) -> Self {
        let mut bytes = Vec::new();
        let (code, code_len) = commit_group(&mut bytes, encoded_cells(cells, "code", 36), CODE);
        let (functions, functions_len) =
            commit_group(&mut bytes, encoded_cells(cells, "index", 1), FUNCTIONS);
        let (controls, controls_len) = commit_group(
            &mut bytes,
            raw_to_cells(&fs::read(control_path).unwrap()),
            CONTROLS,
        );
        let (runtime, runtime_len) = commit_group(
            &mut bytes,
            raw_to_cells(&fs::read(runtime_path).unwrap()),
            RUNTIME,
        );
        let host = FixtureHost(Rc::new(bytes));
        Self {
            host,
            code: (code, code_len),
            functions: (functions, functions_len),
            controls: (controls, controls_len),
            runtime: (runtime, runtime_len),
        }
    }

    fn rom<'a, const RESIDENT: usize>(
        &self,
        group: &'a (Vec<Shard>, u32),
    ) -> BytecodeRom<'a, FixtureHost, RESIDENT> {
        BytecodeRom::new(self.host.clone(), &group.0, group.1).unwrap()
    }

    pub fn program<const RESIDENT: usize, const CACHE: usize>(
        &self,
    ) -> RomCode<'_, FixtureHost, RESIDENT, CACHE> {
        RomCode::new(
            self.rom(&self.code),
            self.rom(&self.functions),
            self.rom(&self.controls),
            self.rom(&self.runtime),
        )
        .unwrap()
    }
}
