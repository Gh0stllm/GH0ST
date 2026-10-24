//! Local fixture benchmark using the actual pinned Nitro instrumentation and host implementation.
use super::*;
use crate::{native,run::RunProgram};
use arbutil::crypto;
use prover::programs::memory::MemoryModel;
use serde_json::json;
#[test]
fn nova_meter_cpu_and_host_gas() -> Result<()> {
    let root=std::path::PathBuf::from(std::env::var("NOVA_STYLUS_ROOT").expect("set NOVA_STYLUS_ROOT"));
    let mut rows=vec![];
    let reference:serde_json::Value=serde_json::from_slice(&std::fs::read(root.join("../layout/sentence-reference.json"))?)?;
    let words=reference["scenarios"][0]["sentences"][0]["words"].as_array().unwrap();
    let expected:Vec<u32>=words.iter().map(|w|w["token"].as_u64().unwrap() as u32|((w["punct"].as_u64().unwrap() as u32)<<16)).collect();
    for (name,module_path,data_dir) in [
        ("raw","wasm-kernel/target-meter/wasm32-unknown-unknown/release/nova_wasm_kernel.wasm","raw-model"),
        ("packed3","wasm-packed3/target-meter/wasm32-unknown-unknown/release/nova_wasm_packed3.wasm","packed3-model"),
        ("delta-packed3","../kernels/wasm-packed/wasm/target-meter/wasm32-unknown-unknown/release/nova_wasm_delta_packed3.wasm","../kernels/wasm-packed/model"),
        ("unroll8","../kernels/wasm-unroll/8/target/wasm32-unknown-unknown/release/nova_wasm_unroll8.wasm","packed3-model"),
        ("unroll16","../kernels/wasm-unroll/16/target/wasm32-unknown-unknown/release/nova_wasm_unroll16.wasm","packed3-model"),
        ("unroll32","../kernels/wasm-unroll/32/target/wasm32-unknown-unknown/release/nova_wasm_unroll32.wasm","packed3-model"),
        ("unroll64","../kernels/wasm-unroll/64/target/wasm32-unknown-unknown/release/nova_wasm_unroll64.wasm","packed3-model"),
        ("unroll128","../kernels/wasm-unroll/128/target/wasm32-unknown-unknown/release/nova_wasm_unroll128.wasm","packed3-model")
    ] {
        let wasm_path=root.join(module_path);
        let bytes=std::fs::read(&wasm_path)?;
        let mut activation_budget=1_000_000_000;
        let info=match native::activate(&bytes,&crypto::keccak(&bytes).into(),3,61,128,false,&mut activation_budget,u32::MAX) {
            Ok((_,info))=>info,
            Err(error)=> { rows.push(json!({"name":name,"activation_failed":true,"error":format!("{error:?}"),"wasm_path":module_path})); continue; }
        };
        for max_code_size in [24576u64,98304u64] {
            let compile=CompileConfig::version(3,false);
            let config=StylusConfig::new(3,22_000,10_000);
            let (mut api,mut evm_data)=api::TestEvmApi::new(compile.clone());
            evm_data.arbos_version=61;
            api.nova_max_code_size=max_code_size;
            for (i,file) in ["core.bin","groups.bin","words.bin","punct.bin","fused.bin","punct-fold.bin","sigmoid-delta.bin","exp-q32.bin","word-punct.bin"].iter().enumerate(){
                api.nova_install_blob((i+1) as u8,&std::fs::read(root.join(data_dir).join(file))?);
            }
            let mut instance=TestInstance::from_path(wasm_path.to_str().unwrap(),api.clone(),evm_data,&compile,config,Target::default())?;
            let footprint=instance.memory_size().0 as u16;
            api.set_pages(footprint);
            let supplied=Ink(1_000_000_000_000);
            let outcome=instance.run_main(&[],config,supplied)?;
            let output=match outcome {UserOutcome::Success(x)=>x,other=>panic!("unexpected outcome {other:?}")};
            let left: Ink=instance.ink_left().into();let used=supplied.0-left.0;
            assert_eq!(output.len(),80,"expected 20 token/punctuation ids");
            let ids:Vec<u32>=output.chunks_exact(4).map(|x|u32::from_le_bytes(x.try_into().unwrap())).collect();
            assert_eq!(ids,expected,"native runtime must match exact reference token ids");
            let stats=*api.nova_stats.lock();
            let memory_gas=MemoryModel::new(2,1000).gas_cost(footprint,0,0).0;
            rows.push(json!({"name":name,"wasm_keccak":hex::encode(crypto::keccak(&bytes)),"stylus_version":3,"max_stack_depth_scenario":22000,"arbos_version_scenario":61,"ink_per_gas":10000,"max_code_size_scenario":max_code_size,"memory_free_pages_scenario":2,"memory_page_gas_scenario":1000,"footprint_pages":footprint,"metered_ink":used,"metered_execution_gas_floor":used/10000,"metered_execution_gas_ceil":used.div_ceil(10000),"host_account_code_calls":stats.0,"cold_code_addresses":stats.1,"account_access_gas_included":stats.2,"full_code_bytes_priced_by_host":stats.3,"initial_memory_gas_not_in_execution_meter":memory_gas,"cached_invocation_overhead_gas_scenario":352u64+u64::from(info.cached_init_cost),"uncached_invocation_overhead_gas_scenario":8832u64+352+u64::from(info.init_cost)+u64::from(info.cached_init_cost),"activation_metered_gas":1_000_000_000-activation_budget,"activation_info":{"init_cost_units":info.init_cost,"cached_init_cost_units":info.cached_init_cost,"asm_estimate":info.asm_estimate},"tokens":ids,"full_swap_metered":false,"chain_configuration_verified":false}));
        }
    }
    let report=json!({"status":"PASS_OFFICIAL_NITRO_OFFLINE_METER","scope":"COMPUTE_AND_NATIVE_HOST_IO_WITH_EXPLICIT_CONFIG_SCENARIOS","nitro_tag":"v3.12.1","nitro_commit":"70fa99a6e711f09eedd96a907290c3df0f3bcf7d","rows":rows,"mainnet_calls":0,"notes":["Actual upstream instruction middleware, dynamic memory/copy charges and native host implementation.","Only local EVM code-read adapter is supplied; it charges pinned geth access-list/code-size formula rather than free IO.","Receipt intrinsic gas, EVM-to-WASM invocation overhead, recurrent state storage and pool settlement are excluded.","Do not interpret local CPU wall time as chain TPS."]});
    let output=std::env::var("NOVA_METER_REPORT").expect("set NOVA_METER_REPORT");
    std::fs::write(output,serde_json::to_vec_pretty(&report)?)?;println!("{}",report);
    Ok(())
}


#[test]
fn nova_meter_seed_distribution() -> Result<()> {
    let root=std::path::PathBuf::from(std::env::var("NOVA_STYLUS_ROOT").expect("set NOVA_STYLUS_ROOT"));
    let wasm_path=std::path::PathBuf::from(std::env::var("NOVA_SEED_WASM").expect("set NOVA_SEED_WASM"));
    let bytes=std::fs::read(&wasm_path)?;
    let reference:serde_json::Value=serde_json::from_slice(&std::fs::read(root.join("../layout/sentence-reference.json"))?)?;
    let mut activation_budget=1_000_000_000;
    let (_,info)=native::activate(&bytes,&crypto::keccak(&bytes).into(),3,61,128,false,&mut activation_budget,u32::MAX)?;
    let compile=CompileConfig::version(3,false);
    let config=StylusConfig::new(3,22_000,10_000);
    let mut rows=vec![];
    for sample in reference["scenarios"][0]["sentences"].as_array().unwrap() {
        let seed=sample["seed_int"].as_u64().unwrap() as u32;
        let expected:Vec<u32>=sample["words"].as_array().unwrap().iter().map(|w|w["token"].as_u64().unwrap() as u32|((w["punct"].as_u64().unwrap() as u32)<<16)).collect();
        let (mut api,mut evm_data)=api::TestEvmApi::new(compile.clone());
        evm_data.arbos_version=61;
        for (i,file) in ["core.bin","groups.bin","words.bin","punct.bin","fused.bin","punct-fold.bin","sigmoid-delta.bin","exp-q32.bin","word-punct.bin"].iter().enumerate(){
            api.nova_install_blob((i+1) as u8,&std::fs::read(root.join("packed3-model").join(file))?);
        }
        let mut instance=TestInstance::from_path(wasm_path.to_str().unwrap(),api.clone(),evm_data,&compile,config,Target::default())?;
        let footprint=instance.memory_size().0 as u16;api.set_pages(footprint);
        let supplied=Ink(1_000_000_000_000);
        let outcome=instance.run_main(&seed.to_be_bytes(),config,supplied)?;
        let output=match outcome {UserOutcome::Success(x)=>x,other=>panic!("unexpected outcome for seed {seed}: {other:?}")};
        let left:Ink=instance.ink_left().into();let used=supplied.0-left.0;
        assert_eq!(output.len()%4,0);
        let ids:Vec<u32>=output.chunks_exact(4).map(|x|u32::from_le_bytes(x.try_into().unwrap())).collect();
        assert_eq!(ids,expected,"native runtime seed {seed} must match exact reference token ids");
        let stats=*api.nova_stats.lock();
        let memory_gas=MemoryModel::new(2,1000).gas_cost(footprint,0,0).0;
        let cached=352u64+u64::from(info.cached_init_cost);
        let uncached=8832u64+352+u64::from(info.init_cost)+u64::from(info.cached_init_cost);
        rows.push(json!({"seed":seed,"words":ids.len(),"metered_ink":used,"metered_execution_gas_ceil":used.div_ceil(10000),"host_account_code_calls":stats.0,"cold_code_addresses":stats.1,"account_access_gas_included":stats.2,"full_code_bytes_priced_by_host":stats.3,"initial_memory_gas_not_in_execution_meter":memory_gas,"cached_invocation_overhead_gas_scenario":cached,"uncached_invocation_overhead_gas_scenario":uncached,"known_cached_execution_plus_initial_memory_and_invocation":used.div_ceil(10000)+memory_gas+cached,"tokens":ids,"exact_reference_tokens_and_punctuation":true}));
    }
    let report=json!({"status":"PASS_OFFICIAL_NITRO_OFFLINE_METER_16_SEEDS","scope":"RESET_HIDDEN_STATE_NEUTRAL_FEATURES_COMPLETE_SENTENCES_NOT_FULL_POOL_SWAPS","nitro_tag":"v3.12.1","nitro_commit":"70fa99a6e711f09eedd96a907290c3df0f3bcf7d","wasm_keccak":hex::encode(crypto::keccak(&bytes)),"wasm_path":wasm_path,"stylus_version":3,"max_stack_depth_scenario":22000,"arbos_version_scenario":61,"ink_per_gas":10000,"max_code_size_scenario":24576,"memory_free_pages_scenario":2,"memory_page_gas_scenario":1000,"temperature_q10":512,"features":[0,0,0,0,1024,1024],"max_words":32,"activation_metered_gas":1_000_000_000-activation_budget,"rows":rows,"mainnet_calls":0,"full_swap_metered":false,"chain_configuration_verified":false});
    std::fs::write(std::env::var("NOVA_SEED_REPORT").expect("set NOVA_SEED_REPORT"),serde_json::to_vec_pretty(&report)?)?;
    println!("{report}");Ok(())
}
