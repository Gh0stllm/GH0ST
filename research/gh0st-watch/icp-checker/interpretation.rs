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
