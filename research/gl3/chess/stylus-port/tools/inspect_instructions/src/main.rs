use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use wasmparser::{
    BinaryReader, BlockType, ConstExpr, ElementItems, ElementKind, FuncType, MemArg, Operator,
    Parser, Payload, RefType, TableInit, TypeRef, ValType, Validator,
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const GUEST_SIMD_SHA: &str = "1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc";
const GUEST_SCALAR_SHA: &str = "ac6478b86950152893e81aa3ec65398687d69938f57fdb7946b7f51767dfaa9d";
const NO_ELSE: u32 = u32::MAX;
const NULL_FUNCTION: u16 = u16::MAX;
const TABLE_SIZE: usize = 473;
const GLOBAL_COUNT: usize = 100;
const SIGNATURE_COUNT: usize = 67;
const USAGE: &str =
    "Usage: gl3-inspect-instructions GUEST [--control-index NEW_FILE] [--runtime-index NEW_FILE]";

fn require(condition: bool, message: &'static str) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(message.into())
    }
}

fn hash(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}

struct RomCoordinates {
    original_code: u32,
    packed_code: u32,
    packed_bytes: u32,
}

impl RomCoordinates {
    /// The partitioner retains the exact preamble and every section except
    /// custom/debug sections and the data section, including section headers.
    fn from_wasm(bytes: &[u8]) -> Result<Self> {
        let mut input = BinaryReader::new(bytes, 0);
        require(
            input.read_bytes(8)? == b"\0asm\x01\0\0\0",
            "Expected a WebAssembly v1 core module",
        )?;
        let mut packed = 8;
        let mut code = None;
        while !input.eof() {
            let start = input.original_position();
            let tag = input.read_u8()?;
            let length = usize::try_from(input.read_var_u32()?)?;
            input.read_bytes(length)?;
            if tag == 10 {
                require(code.is_none(), "Duplicate code section")?;
                code = Some((start, packed));
            }
            if !matches!(tag, 0 | 11) {
                packed += input.original_position() - start;
            }
        }
        let (original, code_offset) = code.ok_or("Missing code section")?;
        Ok(Self {
            original_code: u32::try_from(original)?,
            packed_code: u32::try_from(code_offset)?,
            packed_bytes: u32::try_from(packed)?,
        })
    }

    fn offset(&self, original: usize) -> Result<u32> {
        let relative = u32::try_from(original)?
            .checked_sub(self.original_code)
            .ok_or("Control instruction precedes the code section")?;
        self.packed_code
            .checked_add(relative)
            .filter(|offset| *offset < self.packed_bytes)
            .ok_or_else(|| "Control instruction is outside the packed code ROM".into())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ControlKind {
    Block,
    Loop,
    If,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ControlRow {
    instruction: u32,
    end: u32,
    else_body: u32,
}

struct OpenControl {
    kind: ControlKind,
    instruction: u32,
    else_body: u32,
}

fn index_bytes(rows: &[ControlRow]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(rows.len() * 12);
    for row in rows {
        bytes.extend(row.instruction.to_be_bytes());
        bytes.extend(row.end.to_be_bytes());
        bytes.extend(row.else_body.to_be_bytes());
    }
    bytes
}

fn operator_info(op: &Operator<'_>) -> (&'static str, &'static str, Option<MemArg>) {
    macro_rules! as_memory_argument {
        (memarg, $arg:ident) => {
            Some(*$arg)
        };
        ($name:ident, $arg:ident) => {
            None
        };
    }
    macro_rules! match_ops {
        ($( @$proposal:ident $name:ident $({ $($arg:ident: $ty:ty),* })? => $visit:ident ($($ann:tt)*))*) => {
            match op {
                $(Operator::$name $({ $($arg),* })? => {
                    $($(let _ = $arg;)*)?
                    (stringify!($name), stringify!($proposal), None $($( .or(as_memory_argument!($arg, $arg)) )*)?)
                })*
                _ => ("Unknown", "unknown", None),
            }
        };
    }
    wasmparser::for_each_operator!(match_ops)
}

#[derive(Default)]
struct Census {
    opcodes: BTreeMap<&'static str, u32>,
    proposals: BTreeMap<&'static str, u32>,
    memory_immediates: BTreeMap<&'static str, u32>,
    alignments: BTreeSet<u8>,
    imported_call_sites: BTreeMap<u32, u32>,
    indirect_types: BTreeSet<u32>,
    local_types: BTreeSet<String>,
    block_types: BTreeMap<String, u32>,
    select_types: BTreeSet<String>,
    function_type_indices: BTreeMap<u32, u32>,
    max_memory_offset: u64,
    max_br_table_targets: u32,
    max_branch_depth: u32,
    max_control_nesting: usize,
    max_locals: u32,
    function_count: usize,
    rows: Vec<ControlRow>,
}

impl Census {
    fn function(
        &mut self,
        body: wasmparser::FunctionBody<'_>,
        coordinates: &RomCoordinates,
        type_index: u32,
        imported: usize,
    ) -> Result<()> {
        *self.function_type_indices.entry(type_index).or_default() += 1;
        let mut locals: u32 = 0;
        for entry in body.get_locals_reader()? {
            let (count, ty) = entry?;
            locals = locals.checked_add(count).ok_or("Local count overflow")?;
            self.local_types.insert(ty.to_string());
        }
        self.max_locals = self.max_locals.max(locals);

        let mut open = Vec::<OpenControl>::new();
        let mut reader = body.get_operators_reader()?;
        let mut function_ended = false;
        while !reader.eof() {
            let (op, original_offset) = reader.read_with_offset()?;
            let (name, proposal, memory) = operator_info(&op);
            require(
                matches!(proposal, "mvp" | "sign_extension" | "simd")
                    || matches!(
                        op,
                        Operator::MemoryCopy { .. } | Operator::MemoryFill { .. }
                    ),
                "Guest uses an unsupported instruction proposal",
            )?;
            *self.opcodes.entry(name).or_default() += 1;
            *self.proposals.entry(proposal).or_default() += 1;
            if let Some(memory) = memory {
                require(
                    memory.memory == 0
                        && memory.offset <= u64::from(u32::MAX)
                        && memory.align <= memory.max_align,
                    "Guest uses an unsupported memory immediate",
                )?;
                self.max_memory_offset = self.max_memory_offset.max(memory.offset);
                self.alignments.insert(memory.align);
                *self.memory_immediates.entry(name).or_default() += 1;
            }
            match op {
                Operator::Block { blockty }
                | Operator::Loop { blockty }
                | Operator::If { blockty } => {
                    let signature = match blockty {
                        BlockType::Empty => "empty".to_owned(),
                        BlockType::Type(ty) => ty.to_string(),
                        BlockType::FuncType(index) => format!("type[{index}]"),
                    };
                    *self.block_types.entry(signature).or_default() += 1;
                    let kind = match op {
                        Operator::Block { .. } => ControlKind::Block,
                        Operator::Loop { .. } => ControlKind::Loop,
                        _ => ControlKind::If,
                    };
                    open.push(OpenControl {
                        kind,
                        instruction: coordinates.offset(original_offset)?,
                        else_body: NO_ELSE,
                    });
                    self.max_control_nesting = self.max_control_nesting.max(open.len());
                }
                Operator::Else => {
                    let current = open.last_mut().ok_or("Else outside any control frame")?;
                    require(
                        current.kind == ControlKind::If && current.else_body == NO_ELSE,
                        "Else does not match a unique if",
                    )?;
                    current.else_body = coordinates.offset(reader.original_position())?;
                }
                Operator::End => {
                    if let Some(current) = open.pop() {
                        self.rows.push(ControlRow {
                            instruction: current.instruction,
                            end: coordinates.offset(original_offset)?,
                            else_body: current.else_body,
                        });
                    } else {
                        require(reader.eof(), "Instructions follow function end")?;
                        function_ended = true;
                    }
                }
                Operator::Br { relative_depth } | Operator::BrIf { relative_depth } => {
                    self.branch(relative_depth, open.len())?;
                }
                Operator::BrTable { targets } => {
                    self.max_br_table_targets = self.max_br_table_targets.max(targets.len());
                    for target in targets.targets() {
                        self.branch(target?, open.len())?;
                    }
                    self.branch(targets.default(), open.len())?;
                }
                Operator::Call { function_index } if (function_index as usize) < imported => {
                    *self.imported_call_sites.entry(function_index).or_default() += 1;
                }
                Operator::CallIndirect {
                    type_index,
                    table_index,
                } => {
                    require(table_index == 0, "Guest uses multiple indirect-call tables")?;
                    self.indirect_types.insert(type_index);
                }
                Operator::TypedSelect { ty } => {
                    self.select_types.insert(ty.to_string());
                }
                Operator::MemorySize { mem }
                | Operator::MemoryGrow { mem }
                | Operator::MemoryFill { mem }
                | Operator::MemoryInit { mem, .. } => {
                    require(mem == 0, "Guest uses multiple memories")?;
                }
                Operator::MemoryCopy { dst_mem, src_mem } => {
                    require(dst_mem == 0 && src_mem == 0, "Guest uses multiple memories")?;
                }
                _ => {}
            }
        }
        require(
            function_ended && open.is_empty(),
            "Unclosed function control frame",
        )?;
        self.function_count += 1;
        Ok(())
    }

    fn branch(&mut self, depth: u32, open: usize) -> Result<()> {
        // The implicit function label is one level beyond the outer explicit block.
        require(
            depth as usize <= open,
            "Branch refers to a nonexistent label",
        )?;
        self.max_branch_depth = self.max_branch_depth.max(depth);
        Ok(())
    }
}

fn i32_initializer(expr: ConstExpr<'_>) -> Result<i32> {
    let mut operators = expr.get_operators_reader();
    let Operator::I32Const { value } = operators.read()? else {
        return Err("Expected an i32.const initializer".into());
    };
    require(
        matches!(operators.read()?, Operator::End) && operators.eof(),
        "Unexpected initializer instructions",
    )?;
    Ok(value)
}

fn runtime_index_bytes(
    signatures: &[FuncType],
    table: &[u16],
    globals: &[i32],
) -> Result<(Vec<u8>, usize)> {
    require(
        signatures.len() == SIGNATURE_COUNT
            && table.len() == TABLE_SIZE
            && globals.len() == GLOBAL_COUNT,
        "Unexpected guest runtime index shape",
    )?;
    let mut bytes =
        Vec::with_capacity(16 + signatures.len() * 6 + table.len() * 2 + globals.len() * 4);
    bytes.extend(b"GL3IR001");
    bytes.extend(u16::try_from(signatures.len())?.to_be_bytes());
    bytes.extend(u16::try_from(table.len())?.to_be_bytes());
    bytes.extend(u16::try_from(globals.len())?.to_be_bytes());
    bytes.extend([0, 0]);
    let mut canonical = BTreeMap::<&FuncType, u16>::new();
    for (index, signature) in signatures.iter().enumerate() {
        let canonical = canonical.entry(signature).or_insert(u16::try_from(index)?);
        bytes.extend(u16::try_from(signature.params().len())?.to_be_bytes());
        bytes.extend(u16::try_from(signature.results().len())?.to_be_bytes());
        bytes.extend(canonical.to_be_bytes());
    }
    for entry in table {
        bytes.extend(entry.to_be_bytes());
    }
    for value in globals {
        bytes.extend(value.to_le_bytes());
    }
    Ok((bytes, canonical.len()))
}

struct Inspection {
    report: Value,
    control_index: Vec<u8>,
    runtime_index: Vec<u8>,
}

fn inspect(raw: &[u8], guest_sha: &str) -> Result<Inspection> {
    Validator::new().validate_all(raw)?;
    let coords = RomCoordinates::from_wasm(raw)?;
    let mut census = Census::default();
    let mut signatures = Vec::new();
    let mut function_types = Vec::new();
    let mut declarations = Vec::new();
    let mut imports = Vec::new();
    let mut globals = Vec::new();
    let mut global_initializers = Vec::new();
    let mut tables = Vec::new();
    let mut table_slots = None;
    let mut memories = Vec::new();
    let mut exports = Vec::new();
    let mut element_segment_count = 0;
    for payload in Parser::new(0).parse_all(raw) {
        match payload? {
            Payload::TypeSection(section) => {
                for entry in section.into_iter_err_on_gc_types() {
                    let ty = entry?;
                    require(
                        ty.results().len() <= 1
                            && ty.params().iter().chain(ty.results()).all(|ty| {
                                matches!(
                                    ty,
                                    ValType::I32 | ValType::I64 | ValType::F32 | ValType::F64
                                )
                            }),
                        "Unsupported guest signature shape",
                    )?;
                    let names = |types: &[wasmparser::ValType]| -> Vec<_> {
                        types.iter().map(ToString::to_string).collect()
                    };
                    signatures.push(
                        json!({"params": names(ty.params()), "results": names(ty.results())}),
                    );
                    function_types.push(ty);
                }
            }
            Payload::ImportSection(section) => {
                for entry in section.into_imports() {
                    let el = entry?;
                    let TypeRef::Func(type_index) = el.ty else {
                        return Err("Expected function-only guest imports".into());
                    };
                    imports.push(
                        json!({"module": el.module, "name": el.name, "typeIndex": type_index}),
                    );
                }
            }
            Payload::FunctionSection(section) => {
                declarations = section
                    .into_iter()
                    .collect::<std::result::Result<Vec<_>, _>>()?;
            }
            Payload::GlobalSection(section) => {
                for entry in section {
                    let global = entry?;
                    require(
                        global.ty.content_type == ValType::I32
                            && !global.ty.shared
                            && global.ty.mutable == matches!(globals.len(), 0 | 98 | 99),
                        "Unsupported guest global shape",
                    )?;
                    let value = i32_initializer(global.init_expr)?;
                    global_initializers.push(value);
                    globals.push(json!({"type": global.ty.content_type.to_string(), "mutable": global.ty.mutable}));
                }
            }
            Payload::MemorySection(section) => {
                for entry in section {
                    let memory = entry?;
                    require(
                        !memory.memory64 && !memory.shared,
                        "Expected ordinary memory32",
                    )?;
                    memories.push(
                        json!({"initialPages": memory.initial, "maximumPages": memory.maximum,
                                         "customPageSizeLog2": memory.page_size_log2}),
                    );
                }
            }
            Payload::TableSection(section) => {
                for entry in section {
                    let entry = entry?;
                    let table = entry.ty;
                    require(
                        table_slots.is_none()
                            && table.element_type == RefType::FUNCREF
                            && !table.table64
                            && !table.shared
                            && table.initial == TABLE_SIZE as u64
                            && table.maximum == Some(table.initial)
                            && matches!(entry.init, TableInit::RefNull),
                        "Expected one fixed, null-initialized funcref table",
                    )?;
                    table_slots = Some(vec![NULL_FUNCTION; TABLE_SIZE]);
                    tables.push(json!({"initial": table.initial, "maximum": table.maximum,
                                       "elementType": table.element_type.to_string(), "table64": table.table64,
                                       "shared": table.shared}));
                }
            }
            Payload::ElementSection(section) => {
                let table = table_slots
                    .as_mut()
                    .ok_or("Guest element section has no table")?;
                let function_count = imports.len() + declarations.len();
                for entry in section {
                    let entry = entry?;
                    let ElementKind::Active {
                        table_index,
                        offset_expr,
                    } = entry.kind
                    else {
                        return Err("Unsupported guest element segment mode".into());
                    };
                    require(
                        table_index.unwrap_or(0) == 0,
                        "Unsupported guest element table index",
                    )?;
                    let ElementItems::Functions(functions) = entry.items else {
                        return Err(
                            "Expected table elements containing direct function indices".into()
                        );
                    };
                    let start = usize::try_from(i32_initializer(offset_expr)?)?;
                    let end = start
                        .checked_add(usize::try_from(functions.count())?)
                        .ok_or("Guest table element range overflows")?;
                    let slots = table
                        .get_mut(start..end)
                        .ok_or("Guest table elements exceed table size")?;
                    for (slot, index) in slots.iter_mut().zip(functions) {
                        let index = index?;
                        let function = u16::try_from(index)?;
                        require(
                            *slot == NULL_FUNCTION && function != NULL_FUNCTION
                                && usize::try_from(index)? < function_count,
                            "Guest table element duplicates a slot or references an invalid function",
                        )?;
                        *slot = function;
                    }
                    element_segment_count += 1;
                }
            }
            Payload::ExportSection(section) => {
                for entry in section {
                    let export = entry?;
                    exports.push(json!({"name": export.name, "kind": format!("{:?}", export.kind), "index": export.index}));
                }
            }
            Payload::CodeSectionEntry(body) => {
                let index = *declarations
                    .get(census.function_count)
                    .ok_or("Unmatched function body")?;
                census.function(body, &coords, index, imports.len())?;
            }
            _ => {}
        }
    }
    require(
        census.function_count == declarations.len(),
        "Missing function body",
    )?;
    census.rows.sort_unstable_by_key(|row| row.instruction);
    require(
        census
            .rows
            .windows(2)
            .all(|pair| pair[0].instruction < pair[1].instruction),
        "Duplicate control instruction offset",
    )?;
    let control_index = index_bytes(&census.rows);
    let table_slots = table_slots.ok_or("Missing guest table")?;
    require(element_segment_count > 0, "Missing guest table elements")?;
    let (runtime_index, unique_signatures) =
        runtime_index_bytes(&function_types, &table_slots, &global_initializers)?;
    let report = json!({
        "scope": "exact-wasm-static-inventory-and-indexes-no-execution",
        "guestSHA256": guest_sha,
        "guestBytes": raw.len(),
        "packedCodeBytes": coords.packed_bytes,
        "originalCodeSectionOffset": coords.original_code,
        "packedCodeSectionOffset": coords.packed_code,
        "controlIndex": {"rowBytes": 12, "rows": census.rows.len(), "bytes": control_index.len(), "sha256": hash(&control_index),
            "row": ["packedCodeOffsetU32BE", "endOpcodeOffsetU32BE", "elseBodyFirstOffsetU32BEOrFfffffff"]},
        "runtimeIndex": {
            "magic": "GL3IR001",
            "bytes": runtime_index.len(),
            "sha256": hash(&runtime_index),
            "signatures": function_types.len(),
            "uniqueSignatures": unique_signatures,
            "tableSlots": table_slots.len(),
            "nullTableSlots": table_slots.iter().filter(|entry| **entry == NULL_FUNCTION).count(),
            "elementSegments": element_segment_count,
            "globals": global_initializers.len()
        },
        "opcodeKinds": census.opcodes.len(),
        "instructionCount": census.opcodes.values().sum::<u32>(),
        "opcodeCounts": census.opcodes,
        "proposalCounts": census.proposals,
        "bodyCount": census.function_count,
        "functionTypeIndices": census.function_type_indices,
        "functionTypes": signatures,
        "imports": imports,
        "directImportedCallSites": census.imported_call_sites,
        "indirectCallTypeIndices": census.indirect_types,
        "localTypes": census.local_types,
        "blockTypes": census.block_types,
        "typedSelectTypes": census.select_types,
        "maximumMemoryImmediateOffset": census.max_memory_offset,
        "memoryImmediateAlignmentsLog2": census.alignments,
        "memoryImmediateOpcodeCounts": census.memory_immediates,
        "memoryIndex": 0,
        "maximumLocalsExcludingParameters": census.max_locals,
        "maximumControlNestingExcludingFunction": census.max_control_nesting,
        "maximumBranchDepth": census.max_branch_depth,
        "maximumBrTableTargetsExcludingDefault": census.max_br_table_targets,
        "memories": memories,
        "tables": tables,
        "globals": globals,
        "exports": exports
    });
    Ok(Inspection {
        report,
        control_index,
        runtime_index,
    })
}

fn write_fresh(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new().create_new(true).write(true).open(path)?;
    file.write_all(bytes)?;
    Ok(())
}

fn run() -> Result<()> {
    let mut args = std::env::args_os().skip(1);
    let guest = PathBuf::from(args.next().ok_or(USAGE)?);
    let mut control_output = None;
    let mut runtime_output = None;
    while let Some(flag) = args.next() {
        let output = match flag.to_str() {
            Some("--control-index") if control_output.is_none() => &mut control_output,
            Some("--runtime-index") if runtime_output.is_none() => &mut runtime_output,
            _ => return Err(USAGE.into()),
        };
        *output = Some(PathBuf::from(args.next().ok_or(USAGE)?));
    }
    require(
        control_output.is_none() || control_output != runtime_output,
        "Control and runtime indexes require different paths",
    )?;
    let data = fs::read(guest)?;
    let guest_sha = hash(&data);
    require(
        matches!(guest_sha.as_str(), GUEST_SIMD_SHA | GUEST_SCALAR_SHA),
        "Unreviewed guest bytes",
    )?;
    let inspection = inspect(&data, &guest_sha)?;
    if let Some(path) = control_output {
        write_fresh(&path, &inspection.control_index)?;
    }
    if let Some(path) = runtime_output {
        write_fresh(&path, &inspection.runtime_index)?;
    }
    let mut out = io::stdout().lock();
    serde_json::to_writer_pretty(&mut out, &inspection.report)?;
    writeln!(out)?;
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Inspection rejected: {error}");
        std::process::exit(1);
    }
}
