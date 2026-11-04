use crate::suite::{check_contract, Rule, RuleResult};
use candid::{CandidType, Deserialize, Principal};
use ic_cdk::call::Call;

#[derive(CandidType)]
struct Arguments {
    args: Vec<String>,
}
#[derive(CandidType, Deserialize)]
struct ModelReply {
    status_code: u16,
    output: String,
    error: String,
    partial: Option<bool>,
    n_tokens_generated: Option<u64>,
    n_prompt_tokens_remaining: Option<u64>,
}
#[derive(CandidType, Deserialize)]
pub struct Interpretation {
    evidence: RuleResult,
    model_answer: Option<String>,
    status: String,
}

async fn model_call(
    model: Principal,
    method: &str,
    args: Vec<String>,
) -> Result<ModelReply, String> {
    let reply = Call::unbounded_wait(model, method)
        .with_arg(Arguments { args })
        .await
        .map_err(|e| e.to_string())?;
    let answer: Result<ModelReply, ModelReply> = reply.candid().map_err(|e| e.to_string())?;
    let result = answer.map_err(|r| r.error)?;
    if result.status_code != 200 || !result.error.is_empty() {
        return Err(format!("Model status {}", result.status_code));
    }
    Ok(result)
}

#[ic_cdk::update]
async fn interpret(
    rule: Rule,
    creation_hex: String,
    model: Principal,
) -> Result<Interpretation, String> {
    if !ic_cdk::api::is_controller(&ic_cdk::api::msg_caller()) {
        return Err("Paid model calls require a checker controller".into());
    }
    if model == Principal::anonymous()
        || model == Principal::management_canister()
        || model == ic_cdk::api::canister_self()
    {
        return Err("Select the dedicated Qwen backend".into());
    }
    let question = match &rule {
        Rule::Mint { .. } => "Did the ordinary caller successfully mint seven units?",
        Rule::Authorization => "Did payment via the intermediary increase the recipient balance?",
        Rule::Withdraw { .. } => "Did the attacker receive more than they deposited?",
        Rule::Underflow => "Did burning one wrap a zero balance to the maximum uint256?",
        Rule::TokenReturn { .. } => {
            "Did the false-return deposit create credit without moving tokens?"
        }
        Rule::Replay => "Did reusing the same signature increase points again?",
    };
    let evidence = check_contract(rule, creation_hex)?;
    let facts: std::collections::BTreeMap<_, _> = evidence.observed.iter().cloned().collect();
    let prompt=format!("<|im_start|>system\nAnswer only from this test run. Answer yes, no or unknown.<|im_end|>\n<|im_start|>user\n{question}\n{}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n",serde_json::to_string(&facts).map_err(|e|e.to_string())?);
    // The IC message counter supplies a distinct cache name even for calls in one round.
    thread_local! {static SEQ:std::cell::Cell<u64>=const{std::cell::Cell::new(0)};}
    let n = SEQ.with(|s| {
        let n = s.get().wrapping_add(1);
        s.set(n);
        n
    });
    let cache = format!("watch-{}-{n}.cache", ic_cdk::api::time());
    let mut result = Interpretation {
        evidence,
        model_answer: None,
        status: "unavailable".into(),
    };
    if let Err(e) = model_call(
        model,
        "new_chat",
        vec!["--prompt-cache".into(), cache.clone()],
    )
    .await
    {
        result.status = format!("model chat could not start: {e}");
        return Ok(result);
    }
    let args = [
        "--prompt-cache",
        &cache,
        "--prompt-cache-all",
        "--simple-io",
        "--no-display-prompt",
        "-n",
        "1",
        "--grammar",
        "root ::= \"yes\" | \"no\" | \"unknown\"",
        "--seed",
        "42",
        "--temp",
        "0",
        "-p",
        &prompt,
    ];
    match model_call(
        model,
        "run_update_full",
        args.iter().map(|x| x.to_string()).collect(),
    )
    .await
    {
        Ok(r)
            if r.partial == Some(false)
                && r.n_tokens_generated == Some(1)
                && r.n_prompt_tokens_remaining == Some(0) =>
        {
            let label = r.output.trim();
            result.status = match label {
                "unknown" => "model abstained",
                "yes" | "no" if (label == "yes") == result.evidence.reproduced => {
                    "agrees with execution"
                }
                "yes" | "no" => "disagrees with execution",
                _ => "invalid output",
            }
            .into();
            if matches!(label, "yes" | "no" | "unknown") {
                result.model_answer = Some(label.into());
            }
        }
        Ok(_) => result.status = "incomplete token or prompt accounting".into(),
        Err(e) => result.status = format!("model unavailable: {e}"),
    }
    Ok(result)
}

// The anonymous endpoint accepts only six enumerated outcomes. No caller controls the
// prompt, canister, output length or file path. Cached notes concern a pattern, not an address.
#[derive(CandidType, Deserialize, Default)]
struct PublicCache {
    spawn_v1: Option<Vec<u8>>,
    notes: std::collections::BTreeMap<Vec<u8>, String>,
    retry_after: u64,
}
thread_local! {
    static CACHE:std::cell::RefCell<PublicCache>=Default::default();
    static BUSY:std::cell::Cell<bool>=const{std::cell::Cell::new(false)};
}
pub fn save_cache() {
    CACHE.with_borrow_mut(|c| {
        c.spawn_v1 = Some(crate::spawn::snapshot());
        ic_cdk::storage::stable_save((&*c,)).expect("save coverage and Spawn state");
        c.spawn_v1 = None;
    });
}
pub fn restore_cache() {
    if ic_cdk::api::stable_size() > 0 {
        let (mut old,): (PublicCache,) =
            ic_cdk::storage::stable_restore().expect("restore coverage cache");
        crate::spawn::restore(old.spawn_v1.take());
        CACHE.with_borrow_mut(|c| *c = old)
    }
}
fn valid_profile(states: &[u8]) -> bool {
    states.len() == 6 && states.iter().all(|x| *x <= 2)
}
#[ic_cdk::query]
fn cached_summary(states: Vec<u8>) -> Option<String> {
    if !valid_profile(&states) {
        return None;
    }
    CACHE.with_borrow(|c| c.notes.get(&states).cloned())
}
#[derive(CandidType, Deserialize)]
struct BalanceStatus {
    cycles: candid::Nat,
    idle_cycles_burned_per_day: candid::Nat,
    settings: ReserveSettings,
}
#[derive(CandidType, Deserialize)]
struct ReserveSettings {
    freezing_threshold: candid::Nat,
}
#[derive(CandidType)]
struct Target {
    canister_id: Principal,
}
async fn has_headroom(model: Principal) -> Result<bool, String> {
    let response = Call::bounded_wait(Principal::management_canister(), "canister_status")
        .with_arg(Target { canister_id: model })
        .await
        .map_err(|_| "Model balance unavailable")?;
    let s: BalanceStatus = response.candid().map_err(|_| "Model reserve unavailable")?;
    let reserve = s.idle_cycles_burned_per_day.0 * s.settings.freezing_threshold.0 / 86400u64;
    Ok(s.cycles.0 >= reserve + 500_000_000_000u64)
}
fn grounded_lines(states: &[u8]) -> (String, String) {
    const NAMES: [&str; 6] = [
        "Mint",
        "Underflow",
        "Reentry",
        "Origin payment",
        "Replay",
        "False transfer credit",
    ];
    let remaining = states.iter().filter(|x| **x == 2).count();
    let first = states
        .iter()
        .position(|x| *x == 1)
        .or_else(|| states.iter().position(|x| *x == 0));
    match first {
        Some(i) => {
            let status = if states[i] == 1 {
                "reproduced"
            } else {
                "not reproduced"
            };
            (
                format!("{} {status}. {remaining} untested.", NAMES[i]),
                format!("{}: {status}; {remaining} untested.", NAMES[i]),
            )
        }
        None => (
            "All six checks remain untested.".into(),
            "None of the six checks ran.".into(),
        ),
    }
}
async fn generate_public(states: &[u8], model: Principal, now: u64) -> Result<String, String> {
    let (a, b) = grounded_lines(states);
    let cache = format!("public-note-{now}.cache");
    model_call(
        model,
        "new_chat",
        vec!["--prompt-cache".into(), cache.clone()],
    )
    .await?;
    // The runtime reinitializes its sampler after each instruction-budget yield.
    // Constrain each continuation to the ungenerated suffix, not the start of the note.
    let mut prompt = format!(
        "Summary: {}",
        states
            .iter()
            .map(|v| char::from(b'0' + *v))
            .collect::<String>()
    );
    let mut output = String::new();
    let mut remaining = 24u64;
    for _ in 0..10 {
        let choices: Vec<String> = [&a, &b]
            .iter()
            .filter_map(|line| line.strip_prefix(&output))
            .map(|suffix| format!("\"{suffix}\""))
            .collect();
        if choices.is_empty() || remaining == 0 {
            break;
        }
        let grammar = format!("root ::= {}", choices.join(" | "));
        let cap = remaining.to_string();
        let args = [
            "--prompt-cache",
            &cache,
            "--prompt-cache-all",
            "--simple-io",
            "--no-display-prompt",
            "-n",
            &cap,
            "--grammar",
            &grammar,
            "--seed",
            "42",
            "--temp",
            "0",
            "-p",
            &prompt,
        ];
        let r = model_call(
            model,
            "run_update",
            args.iter().map(|s| s.to_string()).collect(),
        )
        .await?;
        let generated = r.n_tokens_generated.ok_or("Missing model token count")?;
        remaining = remaining
            .checked_sub(generated)
            .ok_or("Model output exceeded its limit")?;
        output.push_str(&r.output);
        if r.n_prompt_tokens_remaining == Some(0) {
            prompt.clear();
            if output == a || output == b {
                return Ok(output);
            }
            if generated == 0 && r.output.is_empty() && !output.is_empty() {
                break;
            }
        }
    }
    Err("Model did not return a complete evidence-matched sentence".into())
}
#[ic_cdk::update]
async fn explain_scan(states: Vec<u8>) -> Result<String, String> {
    if !valid_profile(&states) {
        return Err("Expected six coverage outcomes".into());
    }
    if let Some(line) = cached_summary(states.clone()) {
        return Ok(line);
    }
    let now = ic_cdk::api::time() / 1_000_000_000;
    if BUSY.with(|b| b.get()) || CACHE.with_borrow(|c| now < c.retry_after) {
        return Err("Cached explanation available".into());
    }
    BUSY.with(|b| b.set(true));
    let model = Principal::from_text("myit3-yyaaa-aaaap-qu75a-cai").unwrap();
    let result = async {
        if !has_headroom(model).await? {
            CACHE.with_borrow_mut(|c| c.retry_after = now + 1800);
            return Err("Model reserve protected".into());
        }
        let line = generate_public(&states, model, now).await?;
        CACHE.with_borrow_mut(|c| {
            c.notes.insert(states, line.clone());
        });
        Ok(line)
    }
    .await;
    if result.is_err() {
        // Delay failed retries; a successful generation leaves the next profile eligible immediately.
        let retry = ic_cdk::api::time() / 1_000_000_000 + 300;
        CACHE.with_borrow_mut(|c| c.retry_after = c.retry_after.max(retry));
    }
    BUSY.with(|b| b.set(false));
    result
}

#[derive(CandidType, Deserialize)]
pub struct SummaryState {
    note: Option<String>,
    can_generate: bool,
}

#[ic_cdk::query]
fn summary_state(states: Vec<u8>) -> SummaryState {
    if !valid_profile(&states) {
        return SummaryState {
            note: None,
            can_generate: false,
        };
    }
    let now = ic_cdk::api::time() / 1_000_000_000;
    CACHE.with_borrow(|c| SummaryState {
        note: c.notes.get(&states).cloned(),
        can_generate: !c.notes.contains_key(&states)
            && !BUSY.with(|b| b.get())
            && now >= c.retry_after,
    })
}
#[cfg(test)]
mod coverage_tests {
    use super::*;
    #[test]
    fn upgrade_preserves_notes_from_a_quota_exhausted_cache() {
        #[derive(CandidType)]
        struct PreviousCache {
            notes: std::collections::BTreeMap<Vec<u8>, String>,
            day: u64,
            attempts: u8,
            retry_after: u64,
        }
        let profile = vec![2, 0, 2, 2, 2, 2];
        let previous = PreviousCache {
            notes: [(
                profile.clone(),
                "Underflow: not reproduced; 5 untested.".to_owned(),
            )]
            .into(),
            day: 123,
            attempts: 2,
            retry_after: 100,
        };
        let bytes = candid::encode_args((previous,)).unwrap();
        let (restored,): (PublicCache,) = candid::decode_args(&bytes).unwrap();
        assert_eq!(
            restored.notes[&profile],
            "Underflow: not reproduced; 5 untested."
        );
        assert_eq!(restored.retry_after, 100);
    }
    #[test]
    fn current_production_cache_migrates_and_spawn_roundtrips() {
        #[derive(CandidType)]
        struct Published {
            notes: std::collections::BTreeMap<Vec<u8>, String>,
            retry_after: u64,
        }
        let current = Published {
            notes: [(vec![2; 6], "All six checks remain untested.".to_owned())].into(),
            retry_after: 4242,
        };
        let bytes = candid::encode_args((current,)).unwrap();
        let (mut migrated,): (PublicCache,) = candid::decode_args(&bytes).unwrap();
        assert!(migrated.spawn_v1.is_none());
        crate::spawn::restore(migrated.spawn_v1.take());
        migrated.spawn_v1 = Some(crate::spawn::snapshot());
        let bytes = candid::encode_args((&migrated,)).unwrap();
        let (mut after,): (PublicCache,) = candid::decode_args(&bytes).unwrap();
        assert_eq!(after.notes[&vec![2; 6]], "All six checks remain untested.");
        assert_eq!(after.retry_after, 4242);
        crate::spawn::restore(Some(after.spawn_v1.take().unwrap()));
        assert_eq!(crate::spawn::snapshot(), migrated.spawn_v1.unwrap());
    }
    #[test]
    fn all_profiles_produce_supported_claims() {
        assert!(!valid_profile(&[0, 1, 2]));
        assert!(!valid_profile(&[3, 0, 0, 0, 0, 0]));
        for mut n in 0u16..729 {
            let mut states = [0; 6];
            for state in &mut states {
                *state = (n % 3) as u8;
                n /= 3;
            }
            assert!(valid_profile(&states));
            let (line, _) = grounded_lines(&states);
            if states.contains(&1) {
                assert!(line.contains(" reproduced.") && !line.contains("not reproduced"))
            } else if states.contains(&0) {
                assert!(line.contains("not reproduced"))
            } else {
                assert_eq!(line, "All six checks remain untested.")
            }
        }
    }
}
