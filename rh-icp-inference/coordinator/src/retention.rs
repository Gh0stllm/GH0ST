//! Admission counts unfinished work, never lifetime history. All historical
//! jobs remain in the unchanged State.jobs map for replay protection/recovery.
use crate::core::{bytes, is_deferred};
use crate::types::*;
use candid::CandidType;
use serde::{Deserialize, Serialize};
use std::ops::Bound::{Excluded, Unbounded};

pub const MAX_OPEN_JOBS: u64 = 1;
pub const MAX_PAGE_JOBS: u32 = 32;
pub const MAX_PAGE_BYTES: usize = 1_000_000;

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct RetentionStatus {
    pub retained: u64,
    pub completed: u64,
    pub failed: u64,
    pub open: u64,
    pub busy: u64,
    pub paused: bool,
    pub verifying: bool,
    pub active: Option<String>,
    pub blocked_failed: bool,
    pub admission_allowed: bool,
}

#[derive(Clone, CandidType, Deserialize, Serialize)]
pub struct JobPage {
    pub jobs: Vec<Job>,
    pub next: Option<String>,
    pub total: u64,
}

pub fn status(state: &State) -> RetentionStatus {
    let mut completed = 0;
    let mut failed = 0;
    let mut open = 0;
    let mut busy = 0;
    for job in state.jobs.values() {
        match job.phase {
            Phase::Complete => completed += 1,
            Phase::Failed => failed += 1,
            _ => open += 1,
        }
        if job.busy { busy += 1; }
    }
    // Preserve the existing owner-review/failed-cache safeguard exactly.
    let blocked_failed = state.jobs.values().any(|job| {
        job.source.is_some() && !is_deferred(state, &job.request.id)
            && (job.phase == Phase::Failed
                || job.recovery.as_ref().is_some_and(|r| r.parked || r.requires_owner))
    });
    RetentionStatus {
        retained: state.jobs.len() as u64, completed, failed, open, busy,
        paused: state.paused, verifying: state.verifying, active: state.active.clone(), blocked_failed,
        admission_allowed: state.config.is_some() && !state.paused && !state.verifying
            && state.active.is_none() && busy == 0 && open < MAX_OPEN_JOBS && !blocked_failed,
    }
}

pub fn require_admission(state: &State) -> Result<(), String> {
    let state = status(state);
    if state.admission_allowed { return Ok(()); }
    if state.paused { return Err("coordinator paused".into()); }
    if state.blocked_failed { return Err("retained failed job requires explicit recovery or deferral".into()); }
    Err("coordinator has unfinished or in-flight work".into())
}

/// Known swaps return exactly their existing record before admission or any
/// verification/model/signature cost. Both source identity fields are retained.
pub fn known_swap(state: &State, transaction_hash: &str, log_index: u64) -> Option<Job> {
    state.jobs.values().find(|job| job.source.is_some()
        && job.request.tx_hash == transaction_hash && job.request.log_index == log_index).cloned()
}

/// Exclusive key cursor plus count AND encoded-byte bounds. A caller can read
/// all retained records without an unbounded Candid reply. No state is changed.
pub fn page(state: &State, after: Option<&str>, limit: u32) -> Result<JobPage, String> {
    if let Some(cursor) = after {
        bytes(cursor, 32)?;
        if cursor.to_lowercase() != cursor { return Err("history cursor must be canonical lowercase".into()); }
    }
    let lower = after.map_or(Unbounded, |cursor| Excluded(cursor.to_owned()));
    let mut entries = state.jobs.range((lower, Unbounded)).peekable();
    let total = state.jobs.len() as u64;
    let mut jobs = Vec::new();
    let mut last = None;
    let mut more = false;
    let count = limit.clamp(1, MAX_PAGE_JOBS) as usize;
    while let Some((id, job)) = entries.next() {
        if id != &job.request.id { return Err("historical job key mismatch".into()); }
        jobs.push(job.clone());
        // Reserve enough space for a continuation key even on a bounded page.
        let tentative = JobPage { jobs: jobs.clone(), next: Some(id.clone()), total };
        if candid::encode_args((tentative,)).map_err(|_| "history page encoding failed")?.len() > MAX_PAGE_BYTES {
            jobs.pop();
            if jobs.is_empty() { return Err("single historical job exceeds the bounded history reply".into()); }
            more = true;
            break;
        }
        last = Some(id.clone());
        if jobs.len() >= count { more = entries.peek().is_some(); break; }
    }
    Ok(JobPage { jobs, next: if more { last } else { None }, total })
}

#[cfg(test)]
mod tests {
    use super::*;
    use candid::Principal;
    fn configured() -> State {
        State { config: Some(Config {
            worker: Principal::anonymous(), model_canister: Principal::anonymous(),
            model_id: format!("0x{}", "11".repeat(32)), artifact_hash: format!("0x{}", "22".repeat(32)),
            model_wasm_hash: format!("0x{}", "33".repeat(32)), chain_id: 4663,
            gateway: format!("0x{}", "44".repeat(20)), rpc_urls: vec![], confirmations: 24,
            model_cycle_budget: 0, ecdsa_key_name: "key_1".into(), swap_sources: None,
        }), ..State::default() }
    }
    fn historical(index: usize, phase: Phase) -> Job {
        let id = format!("0x{index:064x}");
        let tx_hash = format!("0x{:064x}", index + 100_000);
        let mut job = Job::new(Request { id: id.clone(), requester: format!("0x{}", "77".repeat(20)),
            model_id: format!("0x{}", "11".repeat(32)), prompt_hash: format!("0x{}", "55".repeat(32)),
            prompt: format!("original input {index}"), max_tokens: 80, deadline: 1000,
            tx_hash: tx_hash.clone(), log_index: 3, block_number: 100 + index as u64,
            block_hash: format!("0x{index:064x}") });
        job.source = Some(SwapSource { manager: format!("0x{}", "66".repeat(20)),
            pool_id: format!("0x{}", "88".repeat(32)), transaction_hash: tx_hash, log_index: 3 });
        job.phase = phase; job.answer = format!("original thought {index}"); job.signature = vec![index as u8; 65];
        job.digest = format!("0x{index:064x}"); job.input_tokens = 268; job.output_tokens = 35;
        job.model_cycles = 1_500_000_000_000 + index as u128;
        job
    }
    fn history(count: usize) -> State {
        let mut state = configured();
        for i in 0..count {
            let job = historical(i, if i % 7 == 0 { Phase::Failed } else { Phase::Complete });
            if job.phase == Phase::Failed {
                state.deferred_swaps.get_or_insert_with(Vec::new).push(DeferredSwap {
                    id: job.request.id.clone(), model_cycles: job.model_cycles,
                    reason: "explicit prior owner deferral".into(), deferred_at: 100,
                });
            }
            state.jobs.insert(job.request.id.clone(), job);
        }
        state
    }
    fn encoded<T: CandidType>(value: T) -> Vec<u8> { candid::encode_args((value,)).unwrap() }

    #[test]
    fn history_size_never_exhausts_admission_and_queries_do_not_mutate_state() {
        for count in [256, 1_000, 4_097] {
            let state = history(count); let before = encoded(state.clone());
            assert!(require_admission(&state).is_ok()); assert_eq!(status(&state).retained, count as u64);
            assert!(status(&state).completed > 0 && status(&state).failed > 0);
            let _ = page(&state, None, 32).unwrap();
            assert_eq!(before, encoded(state));
        }
    }
    #[test]
    fn all_ongoing_and_owner_review_guards_remain_closed() {
        let base = history(300);
        for mode in 0..7 {
            let mut s = base.clone();
            match mode {
                0 => s.paused = true, 1 => s.verifying = true,
                2 => s.active = Some(format!("0x{:064x}", 9999)),
                3 => { let j = historical(9999, Phase::Running); s.jobs.insert(j.request.id.clone(), j); },
                4 => { let mut j = historical(9999, Phase::Failed); j.busy = true; s.jobs.insert(j.request.id.clone(), j); },
                5 => { let j = historical(9999, Phase::Failed); s.jobs.insert(j.request.id.clone(), j); },
                _ => s.config = None,
            }
            assert!(require_admission(&s).is_err(), "mode {mode}");
        }
    }
    #[test]
    fn duplicate_old_swap_still_returns_byte_identical_signed_result() {
        let mut s = history(400); let original = s.jobs.values().nth(250).unwrap().clone();
        s.paused = true; s.verifying = true; s.active = Some("another source".into());
        let found = known_swap(&s, &original.request.tx_hash, original.request.log_index).unwrap();
        assert_eq!(encoded(original.clone()), encoded(found));
        assert!(known_swap(&s, &original.request.tx_hash, original.request.log_index + 1).is_none());
    }
    #[test]
    fn exclusive_cursor_walk_preserves_every_old_record_once() {
        let s = history(301); let mut cursor = None; let mut all = Vec::new();
        loop {
            let p = page(&s, cursor.as_deref(), 32).unwrap();
            assert!(p.jobs.len() <= 32); assert_eq!(p.total, 301); assert!(encoded(p.clone()).len() <= MAX_PAGE_BYTES);
            for j in p.jobs { all.push(encoded(j)); }
            cursor = p.next; if cursor.is_none() { break; }
        }
        assert_eq!(all, s.jobs.values().cloned().map(encoded).collect::<Vec<_>>());
        assert_eq!(page(&s, None, 0).unwrap().jobs.len(), 1);
        assert_eq!(page(&s, None, u32::MAX).unwrap().jobs.len(), 32);
        assert!(page(&s, Some(&format!("0x{:064x}", 99999)), 32).unwrap().jobs.is_empty());
        assert!(page(&s, Some("invalid"), 32).is_err());
    }
    #[test]
    fn byte_bound_handles_large_legacy_records_without_truncation() {
        let mut s = history(20);
        for j in s.jobs.values_mut() { j.answer = "x".repeat(200_000); }
        let first = page(&s, None, 32).unwrap();
        assert!(!first.jobs.is_empty() && first.jobs.len() < 20 && first.next.is_some());
        assert!(encoded(first.clone()).len() <= MAX_PAGE_BYTES);
        let mut s = configured(); let mut j = historical(1, Phase::Complete); j.answer = "x".repeat(MAX_PAGE_BYTES + 1);
        s.jobs.insert(j.request.id.clone(), j);
        assert!(page(&s, None, 32).is_err());
    }
}
