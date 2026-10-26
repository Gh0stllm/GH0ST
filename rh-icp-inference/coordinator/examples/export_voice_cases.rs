//! Synthetic verified-swap-style contexts for native quality evaluation. These
//! are test inputs, not claims about actual swaps or model-generated examples.
use gh0st_icp_coordinator::{
    core::{framed_prompt, hash, hex0},
    persona, swaps,
    types::*,
};
use serde_json::json;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let repairs: Vec<serde_json::Value> = if args.len() == 3 && args[1] == "--repairs" {
        serde_json::from_str(&std::fs::read_to_string(&args[2]).unwrap()).unwrap()
    } else {
        vec![]
    };
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../tests/fixtures/bridge-vector.json")).unwrap();
    let mut config: Config = serde_json::from_value(fixture["config"].clone()).unwrap();
    let mut pool = SwapPool {
        manager: "0x8366a39cc670b4001a1121b8f6a443a643e40951".into(),
        pool_id: String::new(),
        currency0: "0x0000000000000000000000000000000000000000".into(),
        currency1: swaps::GH0ST.into(),
        fee: 3000,
        tick_spacing: 60,
        hook: "0x25e6366c490225358625d941c7b147360b155040".into(),
    };
    pool.pool_id = swaps::pool_id(&pool).unwrap();
    config.swap_sources = Some(vec![pool.clone()]);
    let cases = [
        ("buy-empty", false, false, 1000u64),
        ("sell-empty", true, false, 1001),
        ("buy-reversal", false, true, 1002),
        ("sell-reversal", true, true, 1002),
        ("buy-after-pause", false, true, 1500),
        ("sell-after-pause", true, true, 1500),
        ("buy-new-source", false, false, 2000),
        ("sell-new-source", true, false, 2001),
    ];
    let mut out = vec![];
    for (name, sell, with_memory, block) in cases {
        let mut memory = VoiceState::default();
        if with_memory {
            memory.memories.push(ThoughtMemory {
                request_id: hex0(hash("previous thought")),
                text: "i put my receipt in the drain. the drain refused the refund.".into(),
                callback_tx_hash: hex0(hash("previous callback")),
                callback_log_index: 1,
                pool_id: pool.pool_id.clone(),
                source_block: 1000,
                manager: Some(pool.manager.clone()),
                direction: if sell { "buy".into() } else { "sell".into() },
            });
            memory.revision = 1;
        }
        let swap = swaps::VerifiedSwap {
            source: SwapSource {
                manager: pool.manager.clone(),
                pool_id: pool.pool_id.clone(),
                transaction_hash: hex0(hash(name)),
                log_index: 7,
            },
            sender: "0x2222222222222222222222222222222222222222".into(),
            amount0: if sell {
                "4000000000000000".into()
            } else {
                "-4000000000000000".into()
            },
            amount1: if sell {
                "-1200000000000000000000".into()
            } else {
                "1200000000000000000000".into()
            },
            sqrt_price_x96: "79228162514264337593543950336".into(),
            liquidity: "1000000000000000000".into(),
            tick: if sell { "-7".into() } else { "7".into() },
            fee: 3000,
            block_number: block,
            block_hash: hex0(hash(format!("block-{block}"))),
        };
        let (request, voice) = persona::create_request(&config, &swap, 1000, &memory).unwrap();
        let baseline=format!("Write one short, cryptic, irreverent GH0ST monologue inspired by a swap. Stay under 200 characters. No URLs or mentions. Pool deltas in raw units: currency0 {}; currency1 {}. Tick {}; fee {}. A swap is a stimulus for your own recurring imagery.",swap.amount0,swap.amount1,swap.tick,swap.fee);
        let seeds: Vec<Vec<u32>> = (1..=2)
            .map(|attempt| {
                (0..=128)
                    .map(|offset| {
                        persona::seed(&request.id, attempt, offset, &voice.profile_hash).unwrap()
                    })
                    .collect()
            })
            .collect();
        let mut row = json!({"name":name,"source_id":request.id,"profile_hash":voice.profile_hash,"profile_version":voice.profile_version,"memory_hash":voice.memory_hash,"prompt":request.prompt,"wire_prompt":framed_prompt(&request.prompt).unwrap(),"baseline_prompt":baseline,"baseline_wire_prompt":framed_prompt(&baseline).unwrap(),"sampling":persona::profile().sampling,"chunk_seeds_by_attempt_and_generated_offset":seeds,"recent_references":persona::recent_references(&memory)});
        if let Some(prior) = repairs.iter().find(|r| r["name"].as_str() == Some(name)) {
            let answer = prior["answer"].as_str().unwrap();
            let mut references = persona::recent_references(&memory);
            if let Some(extra) = prior.get("recent_references") {
                for text in serde_json::from_value::<Vec<String>>(extra.clone()).unwrap() {
                    if !references.contains(&text) {
                        references.push(text);
                    }
                }
            }
            row["recent_references"] = json!(references);
            let checked = persona::validate_thought(answer, &references);
            row["first_pass_valid"] = json!(checked.is_ok());
            if let Err(reason) = checked {
                let mut job = Job::new(request.clone());
                job.voice = Some(voice);
                job.answer = answer.into();
                job.input_tokens = prior["input_tokens"].as_u64().unwrap_or(0);
                job.output_tokens = prior["output_tokens"].as_u64().unwrap_or(0);
                persona::prepare_repair(&mut job, &reason).unwrap();
                row["repair_prompt"] = json!(job.request.prompt);
                row["repair_wire_prompt"] = json!(framed_prompt(&job.request.prompt).unwrap());
                row["repair_reason"] = json!(reason);
            }
        }
        out.push(row);
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({"profile_hash":persona::profile_hash(),"cases":out}))
            .unwrap()
    );
}
