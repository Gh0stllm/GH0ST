"""Apply host-only linkage to the isolated Linux JIT checkout; keep Cargo.lock."""
from pathlib import Path
import hashlib,json,difflib,platform,shutil
assert platform.system()=='Linux'
r=Path('/root/gl3-aot-jit');s=r/'source';kit=r/'kit';out=r/'evidence';out.mkdir(exist_ok=True)
sha=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
expected={'crates/jit/src/machine.rs':'87b5ba62d395c3a4b6988387d37ab9530356e8e829d6688a5065c35f9657c0b7','crates/jit/src/lib.rs':'3fead9139de14f7cac7d13f6a04281a08775dad2b7c0eac3eb7533f6aaf561a5','Cargo.lock':'0a90dde1a45d9abb5c54503fa89efe5abd0fe0ca2531071f445cfcc92b14f42a'}
for name,h in expected.items():assert sha(s/name)==h,name
before={name:(s/name).read_text() for name in ['crates/jit/src/machine.rs','crates/jit/src/lib.rs','crates/jit/src/main.rs']}
p=s/'crates/jit/src/lib.rs';p.write_text(p.read_text().replace('mod caller_env;','mod caller_env;\nmod aot_bridge;',1))
p=s/'crates/jit/src/machine.rs';t=p.read_text();t=t.replace('    engine: Engine,','    engine: Engine,\n    aot_module: Option<Module>,',1)
t=t.replace('    Ok(CompiledModule { module, engine })','    let aot_module = match std::env::var_os("GL3_AOT_COMPANION") {\n        Some(path) => Some(Module::new(&engine, std::fs::read(path)?)?),\n        None => None,\n    };\n    Ok(CompiledModule { module, engine, aot_module })',1)
t=t.replace('    let imports = imports(&mut store, &func_env);','    let mut imports = imports(&mut store, &func_env);\n    let aot_instance = match &compiled.aot_module {\n        Some(module) => Some(crate::aot_bridge::link(&mut store, &func_env, module, &mut imports)?),\n        None => None,\n    };',1)
t=t.replace('    func_env.as_mut(&mut store).memory = Some(memory);','    func_env.as_mut(&mut store).memory = Some(memory);\n    func_env.as_mut(&mut store).aot_instance = aot_instance;',1)
t=t.replace('    pub memory: Option<Memory>,','    pub memory: Option<Memory>,\n    // Retain the exact companion instance for every imported cross-module call.\n    pub aot_instance: Option<Instance>,',1);p.write_text(t)
shutil.copyfile(kit/'aot_bridge.rs',s/'crates/jit/src/aot_bridge.rs')
p=s/'crates/jit/src/main.rs';t=p.read_text();anchor='    let runtime = format!("{}ms", result.runtime.as_millis());';assert t.count(anchor)==1
report='''    if let Some(path) = std::env::var_os("GL3_AOT_JIT_REPORT") {
        let actual = serde_json::json!({
            "BlockHash": format!("0x{}",hex::encode(result.new_state.last_block_hash.0)),
            "SendRoot": format!("0x{}",hex::encode(result.new_state.last_send_root.0)),
            "Batch": result.new_state.inbox_position,
            "PosInBatch": result.new_state.position_within_message,
        });
        let expected = expected_state.as_ref().map(|x| serde_json::json!({
            "BlockHash": format!("0x{}",hex::encode(x.block_hash.0)),
            "SendRoot": format!("0x{}",hex::encode(x.send_root.0)),
            "Batch": x.batch, "PosInBatch": x.pos_in_batch,
        }));
        let value = serde_json::json!({"diagnosticOnly":true,
            "interpreterOrOSPAcceptance":false,"engineOrGuestBytesModified":false,
            "actual":actual,"expected":expected,"runtimeSeconds":result.runtime.as_secs_f64(),
            "guestMemoryBytes":result.memory_used.bytes().0,
            "guestError":result.error.as_ref().map(|x|x.to_string())});
        std::fs::write(path, serde_json::to_vec_pretty(&value)?)?;
    }
'''
p.write_text(t.replace(anchor,report+'\n'+anchor,1))
patch=''
for name,original in before.items():patch+=''.join(difflib.unified_diff(original.splitlines(True),(s/name).read_text().splitlines(True),fromfile='a/'+name,tofile='b/'+name))
(out/'host-linkage.patch').write_text(patch)
assert sha(s/'Cargo.lock')==expected['Cargo.lock']
(out/'source-provenance.json').write_text(json.dumps({'before':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in before.items()},'after':{k:sha(s/k) for k in before},'newModuleSHA256':sha(s/'crates/jit/src/aot_bridge.rs'),'CargoLockSHA256':sha(s/'Cargo.lock'),'guestAndCompanionSourceUnmodified':True,'scope':'Diagnostic host JIT multi-module linking and result reporting only'},indent=2)+'\n')
