//! A bounded public evidence board. Only the Robinhood escrow holds funds.
//! Submitted text and links are unverified and must be rendered as plain text.
use candid::{CandidType, Deserialize, Principal};
use std::{cell::RefCell, collections::BTreeMap};

#[path = "bounty_rewards.rs"]
mod rewards;
use rewards::Action as RewardAction;
pub use rewards::{BountyReward, BountyRewardConfig};

const SECOND: u64 = 1_000;
const MINUTE: u64 = 60 * SECOND;
const HOUR: u64 = 60 * MINUTE;
const DAY: u64 = 24 * HOUR;
const MAX_BOUNTIES: usize = 256;
const MAX_OWNER_BOUNTIES: usize = 8;
const MAX_SUBMISSIONS: usize = 16;
const MAX_SNAPSHOT_BYTES: usize = 16 * 1024 * 1024;
const MAX_ARGUMENT_BYTES: usize = 6_144;
const SYNC_COOLDOWN: u64 = 30 * SECOND;
const SYNC_LEASE: u64 = 2 * MINUTE;
const MAX_DAILY_SYNCS: usize = 72;

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct BountyInput {
    pub title: String,
    pub description: String,
    pub category: String,
    pub deadline: Option<u64>,
}
#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct BountySubmission {
    pub id: u64,
    pub submitter: Principal,
    pub proof_url: String,
    pub note: String,
    pub status: String,
    pub created_at: u64,
    pub reviewed_at: Option<u64>,
    pub payout_wallet: Option<String>,
}
#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct Bounty {
    pub id: u64,
    pub owner: Principal,
    pub title: String,
    pub description: String,
    pub category: String,
    pub deadline: Option<u64>,
    pub status: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub submissions: Vec<BountySubmission>,
    pub reward: Option<BountyReward>,
}
#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct BountySummary {
    pub id: u64,
    pub owner: Principal,
    pub title: String,
    pub category: String,
    pub deadline: Option<u64>,
    pub status: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub submission_count: u32,
    pub reward: Option<BountyReward>,
}
#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct BountyPage {
    pub items: Vec<BountySummary>,
    pub next: Option<u64>,
}
impl Bounty {
    fn summary(&self) -> BountySummary {
        BountySummary {
            id: self.id,
            owner: self.owner,
            title: self.title.clone(),
            category: self.category.clone(),
            deadline: self.deadline,
            status: self.status.clone(),
            created_at: self.created_at,
            updated_at: self.updated_at,
            submission_count: self.submissions.len() as u32,
            reward: self.reward.clone(),
        }
    }
    fn close_pending(&mut self, at: u64) {
        for s in &mut self.submissions {
            if s.status == "pending" {
                s.status = "not_selected".into();
                s.reviewed_at = Some(at);
            }
        }
    }
}
#[derive(CandidType, Deserialize)]
struct StoredBounty {
    bounty: Bounty,
    hidden: bool,
}
#[derive(CandidType, Deserialize, Default)]
struct Board {
    bounties: BTreeMap<u64, StoredBounty>,
    bounty_sequence: u64,
    submission_sequence: u64,
    creates: Vec<(Principal, u64)>,
    writes: Vec<(Principal, u64)>,
    reward_config: Option<BountyRewardConfig>,
    reward_syncs: Option<Vec<(Principal, u64, u64)>>,
}
thread_local! {
    static BOARD: RefCell<Board> = RefCell::default();
    static ACTIVE_SYNCS: RefCell<BTreeMap<u64, (Principal, u64)>> = RefCell::default();
}

struct SyncLease {
    id: u64,
    caller: Principal,
    started: u64,
}

impl SyncLease {
    fn acquire(id: u64, caller: Principal, at: u64) -> Result<Self, String> {
        ACTIVE_SYNCS.with_borrow_mut(|active| {
            active.retain(|_, (_, started)| at.saturating_sub(*started) < SYNC_LEASE);
            if active.len() >= 4
                || active.contains_key(&id)
                || active.values().any(|(owner, _)| *owner == caller)
            {
                return Err("Reward verification is already in progress. Retry later.".into());
            }
            active.insert(id, (caller, at));
            Ok(Self {
                id,
                caller,
                started: at,
            })
        })
    }

    fn recheck(&self, reward: &BountyReward) -> Result<(), String> {
        let active = now().saturating_sub(self.started) < SYNC_LEASE
            && ACTIVE_SYNCS
                .with_borrow(|active| active.get(&self.id) == Some(&(self.caller, self.started)));
        if !active {
            return Err(
                "The verification attempt expired. Retry with the same transaction hash.".into(),
            );
        }
        BOARD.with_borrow(|b| b.check_sync(self.caller, self.id, reward))
    }
}

impl Drop for SyncLease {
    fn drop(&mut self) {
        ACTIVE_SYNCS.with_borrow_mut(|active| {
            if active.get(&self.id) == Some(&(self.caller, self.started)) {
                active.remove(&self.id);
            }
        });
    }
}

fn authenticated(caller: Principal) -> Result<(), String> {
    if caller == Principal::anonymous() || caller == Principal::management_canister() {
        Err("Sign in to use the bounty board.".into())
    } else {
        Ok(())
    }
}
fn now() -> u64 {
    ic_cdk::api::time() / 1_000_000
}
fn plain(s: &str, min: usize, max: usize, multiline: bool) -> Result<String, String> {
    let s = s.trim();
    if s.len() < min
        || s.len() > max
        || s.contains(['<', '>'])
        || s.chars()
            .any(|c| c.is_control() && !(multiline && matches!(c, '\n' | '\t')))
    {
        return Err(format!(
            "Use {min} to {max} UTF-8 bytes of plain text without HTML or control characters."
        ));
    }
    Ok(s.into())
}
fn validate_input(mut input: BountyInput, at: u64) -> Result<BountyInput, String> {
    input.title = plain(&input.title, 3, 100, false)?;
    input.description = plain(&input.description, 20, 4_000, true)?;
    if !["research", "build", "content", "other"].contains(&input.category.as_str()) {
        return Err("Choose research, build, content or other.".into());
    }
    if input
        .deadline
        .is_some_and(|d| d <= at || d > at.saturating_add(365 * DAY))
    {
        return Err("Choose a future deadline within one year, in UNIX milliseconds.".into());
    }
    Ok(input)
}
fn proof_url(raw: &str) -> Result<String, String> {
    // Deliberately narrower than a browser URL parser. No credentials, IP hosts,
    // ports, backslashes, markup, whitespace or Unicode hostname ambiguity.
    let raw = raw.trim();
    let error = "Use a public HTTPS proof link without credentials, ports, spaces or markup.";
    if raw.len() > 1_024
        || !raw.is_ascii()
        || raw
            .bytes()
            .any(|c| c.is_ascii_control() || c.is_ascii_whitespace() || b"<>\"'`\\".contains(&c))
    {
        return Err(error.into());
    }
    let rest = raw.strip_prefix("https://").ok_or(error)?;
    let host = rest.split(['/', '?', '#']).next().ok_or(error)?;
    let labels: Vec<_> = host.split('.').collect();
    if host.len() > 253
        || labels.len() < 2
        || labels.iter().any(|label| {
            label.is_empty()
                || label.len() > 63
                || !label
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-')
                || !label.as_bytes()[0].is_ascii_alphanumeric()
                || !label.as_bytes()[label.len() - 1].is_ascii_alphanumeric()
        })
        || !labels
            .last()
            .unwrap()
            .bytes()
            .all(|c| c.is_ascii_alphabetic())
        || labels.last().unwrap().len() < 2
        || ["localhost", "local", "internal", "invalid", "test"]
            .contains(&labels.last().unwrap().to_ascii_lowercase().as_str())
    {
        return Err(error.into());
    }
    Ok(raw.into())
}
impl Board {
    fn visible(&self, id: u64) -> Result<&Bounty, String> {
        self.bounties
            .get(&id)
            .filter(|b| !b.hidden)
            .map(|b| &b.bounty)
            .ok_or_else(|| "This bounty is unavailable.".into())
    }
    fn list(&self, cursor: Option<u64>, limit: u32) -> BountyPage {
        let limit = limit.clamp(1, 20) as usize;
        let mut items: Vec<_> = self
            .bounties
            .iter()
            .rev()
            .filter(|(id, stored)| !stored.hidden && cursor.is_none_or(|c| **id < c))
            .take(limit + 1)
            .map(|(_, b)| b.bounty.summary())
            .collect();
        let more = items.len() > limit;
        items.truncate(limit);
        BountyPage {
            next: if more {
                items.last().map(|b| b.id)
            } else {
                None
            },
            items,
        }
    }
    fn check_rate(&self, caller: Principal, at: u64, create: bool) -> Result<(), String> {
        if self
            .writes
            .iter()
            .filter(|(_, t)| at.saturating_sub(*t) < HOUR)
            .count()
            >= 240
            || self
                .writes
                .iter()
                .filter(|(_, t)| at.saturating_sub(*t) < MINUTE)
                .count()
                >= 20
        {
            return Err("The public board is at its write limit. Try again later.".into());
        }
        if self
            .writes
            .iter()
            .any(|(p, t)| *p == caller && at.saturating_sub(*t) < 10 * SECOND)
        {
            return Err("Wait ten seconds between board actions.".into());
        }
        if create {
            if self
                .creates
                .iter()
                .filter(|(_, t)| at.saturating_sub(*t) < DAY)
                .count()
                >= 100
                || self
                    .creates
                    .iter()
                    .filter(|(_, t)| at.saturating_sub(*t) < HOUR)
                    .count()
                    >= 30
            {
                return Err("New bounty registrations are temporarily at capacity.".into());
            }
            if self
                .creates
                .iter()
                .any(|(p, t)| *p == caller && at.saturating_sub(*t) < MINUTE)
            {
                return Err("Wait one minute between new bounties.".into());
            }
        }
        Ok(())
    }
    fn admit(&mut self, caller: Principal, at: u64, create: bool) -> Result<(), String> {
        self.check_rate(caller, at, create)?;
        self.writes.retain(|(_, t)| at.saturating_sub(*t) < HOUR);
        self.creates.retain(|(_, t)| at.saturating_sub(*t) < DAY);
        if create {
            self.creates.push((caller, at));
        }
        self.writes.push((caller, at));
        Ok(())
    }
    fn create(&mut self, caller: Principal, input: BountyInput, at: u64) -> Result<Bounty, String> {
        authenticated(caller)?;
        let input = validate_input(input, at)?;
        if self.bounties.len() >= MAX_BOUNTIES {
            return Err("This beta board is full.".into());
        }
        if self
            .bounties
            .values()
            .filter(|b| b.bounty.owner == caller)
            .count()
            >= MAX_OWNER_BOUNTIES
        {
            return Err("Each creator can publish up to eight bounties in this beta.".into());
        }
        let id = self
            .bounty_sequence
            .checked_add(1)
            .ok_or("Bounty counter exhausted.")?;
        self.admit(caller, at, true)?;
        self.bounty_sequence = id;
        let bounty = Bounty {
            id,
            owner: caller,
            title: input.title,
            description: input.description,
            category: input.category,
            deadline: input.deadline,
            status: "open".into(),
            created_at: at,
            updated_at: at,
            submissions: vec![],
            reward: None,
        };
        self.bounties.insert(
            id,
            StoredBounty {
                bounty: bounty.clone(),
                hidden: false,
            },
        );
        Ok(bounty)
    }
    fn submit(
        &mut self,
        caller: Principal,
        id: u64,
        url: String,
        note: String,
        at: u64,
    ) -> Result<Bounty, String> {
        self.submit_proof(caller, id, url, note, None, at)
    }
    fn submit_proof(
        &mut self,
        caller: Principal,
        id: u64,
        url: String,
        note: String,
        payout_wallet: Option<String>,
        at: u64,
    ) -> Result<Bounty, String> {
        authenticated(caller)?;
        let url = proof_url(&url)?;
        let note = plain(&note, 0, 1_000, true)?;
        let bounty = self.visible(id)?;
        if bounty.owner == caller {
            return Err("Creators cannot submit to their own bounty.".into());
        }
        if bounty.status != "open" || bounty.deadline.is_some_and(|d| at >= d) {
            return Err("This bounty is closed to new submissions.".into());
        }
        match (&bounty.reward, &payout_wallet) {
            (None, None) => {}
            (Some(reward), Some(wallet)) if reward.status == "funded" => {
                if self
                    .reward_config
                    .as_ref()
                    .is_some_and(|c| c.escrow_address == *wallet)
                {
                    return Err("The escrow address cannot receive a reward.".into());
                }
            }
            (Some(_), Some(_)) => {
                return Err("Wait for the creator to verify escrow funding.".into())
            }
            (Some(_), None) => {
                return Err("A reward bounty requires a Robinhood payout wallet.".into())
            }
            (None, Some(_)) => return Err("This is a proof-only bounty.".into()),
        }
        if bounty.submissions.len() >= MAX_SUBMISSIONS {
            return Err("This bounty has reached its submission limit.".into());
        }
        if bounty.submissions.iter().any(|s| s.submitter == caller) {
            return Err("Each participant can submit one proof per bounty.".into());
        }
        let sid = self
            .submission_sequence
            .checked_add(1)
            .ok_or("Submission counter exhausted.")?;
        self.admit(caller, at, false)?;
        self.submission_sequence = sid;
        let bounty = &mut self.bounties.get_mut(&id).unwrap().bounty;
        bounty.submissions.push(BountySubmission {
            id: sid,
            submitter: caller,
            proof_url: url,
            note,
            status: "pending".into(),
            created_at: at,
            reviewed_at: None,
            payout_wallet,
        });
        bounty.updated_at = at;
        Ok(bounty.clone())
    }
    fn review(
        &mut self,
        caller: Principal,
        id: u64,
        sid: u64,
        approve: bool,
        at: u64,
    ) -> Result<Bounty, String> {
        authenticated(caller)?;
        let bounty = self.visible(id)?;
        if bounty.owner != caller {
            return Err("Only the bounty creator can review submissions.".into());
        }
        if bounty.status != "open" {
            return Err("This bounty is already closed.".into());
        }
        if approve && bounty.reward.is_some() {
            return Err(
                "Approve and pay the submission in escrow, then sync the transaction.".into(),
            );
        }
        let index = bounty
            .submissions
            .iter()
            .position(|s| s.id == sid)
            .ok_or("Submission not found.")?;
        if bounty.submissions[index].status != "pending" {
            return Err("This submission was already reviewed.".into());
        }
        self.admit(caller, at, false)?;
        let bounty = &mut self.bounties.get_mut(&id).unwrap().bounty;
        let s = &mut bounty.submissions[index];
        s.status = if approve { "approved" } else { "rejected" }.into();
        s.reviewed_at = Some(at);
        bounty.updated_at = at;
        if approve {
            bounty.status = "completed".into();
            bounty.close_pending(at);
        }
        Ok(bounty.clone())
    }
    fn cancel(&mut self, caller: Principal, id: u64, at: u64) -> Result<Bounty, String> {
        authenticated(caller)?;
        let bounty = self.visible(id)?;
        if bounty.owner != caller {
            return Err("Only the bounty creator can cancel it.".into());
        }
        if bounty.status != "open" {
            return Err("This bounty is already closed.".into());
        }
        if bounty.reward.is_some() {
            return Err("Cancel in escrow, then sync the transaction.".into());
        }
        self.admit(caller, at, false)?;
        let bounty = &mut self.bounties.get_mut(&id).unwrap().bounty;
        bounty.status = "cancelled".into();
        bounty.updated_at = at;
        bounty.close_pending(at);
        Ok(bounty.clone())
    }
    fn configure_reward(&mut self, address: &str) -> Result<BountyRewardConfig, String> {
        if self.reward_config.is_some() {
            return Err("The reward escrow is already configured.".into());
        }
        let config = BountyRewardConfig::new(address)?;
        self.reward_config = Some(config.clone());
        Ok(config)
    }
    fn prepare_reward(
        &mut self,
        caller: Principal,
        id: u64,
        reward: BountyReward,
        at: u64,
    ) -> Result<Bounty, String> {
        authenticated(caller)?;
        let config = self
            .reward_config
            .as_ref()
            .ok_or("Rewards are not enabled on this board.")?;
        if reward.creator_wallet == config.escrow_address {
            return Err("Use the wallet that will fund the reward.".into());
        }
        let bounty = self.visible(id)?;
        if bounty.owner != caller {
            return Err("Only the bounty creator can prepare a reward.".into());
        }
        if bounty.status != "open"
            || bounty.deadline.is_some_and(|d| at >= d)
            || !bounty.submissions.is_empty()
        {
            return Err("A reward requires an open, unexpired bounty with no submissions.".into());
        }
        if bounty.reward.is_some() {
            return Err("This bounty already has a reward setup.".into());
        }
        self.admit(caller, at, false)?;
        let bounty = &mut self.bounties.get_mut(&id).unwrap().bounty;
        bounty.reward = Some(reward);
        bounty.updated_at = at;
        Ok(bounty.clone())
    }
    fn sync_bounty(&self, caller: Principal, id: u64) -> Result<&Bounty, String> {
        // Moderation controls public visibility. The owner can still record a
        // payout or refund on an escrow they opened before a listing was hidden.
        self.bounties
            .get(&id)
            .filter(|b| b.bounty.owner == caller)
            .map(|b| &b.bounty)
            .ok_or_else(|| "Only the bounty creator can sync its reward.".into())
    }
    fn check_sync(
        &self,
        caller: Principal,
        id: u64,
        expected: &BountyReward,
    ) -> Result<(), String> {
        let bounty = self.sync_bounty(caller, id)?;
        if bounty.status != "open" || bounty.reward.as_ref() != Some(expected) {
            return Err(
                "The bounty changed while verifying this transaction. Reload and retry.".into(),
            );
        }
        Ok(())
    }
    fn admit_sync(&mut self, caller: Principal, id: u64, at: u64) -> Result<(), String> {
        let syncs = self.reward_syncs.get_or_insert_with(Vec::new);
        syncs.retain(|(_, _, t)| at.saturating_sub(*t) < DAY);
        if syncs.len() >= MAX_DAILY_SYNCS
            || syncs
                .iter()
                .filter(|(_, _, t)| at.saturating_sub(*t) < HOUR)
                .count()
                >= 24
            || syncs
                .iter()
                .filter(|(_, _, t)| at.saturating_sub(*t) < MINUTE)
                .count()
                >= 4
        {
            return Err("Reward verification has reached its shared capacity. Retry later.".into());
        }
        if syncs.iter().any(|(p, bounty_id, t)| {
            (*p == caller || *bounty_id == id) && at.saturating_sub(*t) < SYNC_COOLDOWN
        }) {
            return Err("Wait thirty seconds between reward verification attempts.".into());
        }
        syncs.push((caller, id, at));
        Ok(())
    }
    fn check_action(
        &self,
        caller: Principal,
        id: u64,
        reward: &BountyReward,
        action: &RewardAction,
    ) -> Result<(), String> {
        self.check_sync(caller, id, reward)?;
        match action {
            RewardAction::Funded { amount } if *amount != reward.amount_wei => Err("The escrow deposit differs from the advertised reward. Cancel it in escrow and sync the refund.".into()),
            _ => Ok(()),
        }
    }
    fn apply_reward(
        &mut self,
        caller: Principal,
        id: u64,
        expected: &BountyReward,
        action: RewardAction,
        tx_hash: String,
        at: u64,
    ) -> Result<Bounty, String> {
        self.check_action(caller, id, expected, &action)?;
        let bounty = &mut self.bounties.get_mut(&id).unwrap().bounty;
        let reward = bounty.reward.as_mut().unwrap();
        reward.tx_hash = Some(tx_hash);
        match action {
            RewardAction::Funded { .. } => reward.status = "funded".into(),
            RewardAction::Paid {
                amount,
                submission_id,
                recipient,
            } => {
                let submission = bounty.submissions.iter_mut().find(|s| {
                    amount == reward.amount_wei
                        && s.id == submission_id
                        && s.payout_wallet.as_ref() == Some(&recipient)
                });
                if let Some(submission) = submission {
                    reward.status = "paid".into();
                    bounty.status = "completed".into();
                    submission.status = "approved".into();
                    submission.reviewed_at = Some(at);
                } else {
                    // Escrow transfers are terminal even if sent outside the board's UI.
                    reward.status = "paid_unmatched".into();
                    bounty.status = "cancelled".into();
                }
                bounty.close_pending(at);
            }
            RewardAction::Cancelled => {
                reward.status = "cancelled".into();
                bounty.status = "cancelled".into();
                bounty.close_pending(at);
            }
        }
        bounty.updated_at = at;
        Ok(bounty.clone())
    }
    fn moderate(&mut self, id: u64, hidden: bool) -> Result<(), String> {
        let stored = self.bounties.get_mut(&id).ok_or("Bounty not found.")?;
        stored.hidden = hidden;
        Ok(())
    }
    fn check_bounds(&self) -> Result<(), String> {
        if self.bounties.len() > MAX_BOUNTIES
            || self.writes.len() > 240
            || self.creates.len() > 100
            || self
                .reward_syncs
                .as_ref()
                .is_some_and(|s| s.len() > MAX_DAILY_SYNCS)
        {
            return Err("Bounty storage exceeds its version-one bounds.".into());
        }
        if let Some(config) = &self.reward_config {
            config.validate()?;
        }
        for (&id, s) in &self.bounties {
            let b = &s.bounty;
            authenticated(b.owner)?;
            if id == 0
                || id != b.id
                || id > self.bounty_sequence
                || b.submissions.len() > MAX_SUBMISSIONS
            {
                return Err("Invalid bounty storage identity or submission bounds.".into());
            }
            plain(&b.title, 3, 100, false)?;
            plain(&b.description, 20, 4_000, true)?;
            if !["research", "build", "content", "other"].contains(&b.category.as_str())
                || !["open", "completed", "cancelled"].contains(&b.status.as_str())
            {
                return Err("Invalid stored bounty state.".into());
            }
            if let Some(reward) = &b.reward {
                let config = self
                    .reward_config
                    .as_ref()
                    .ok_or("Missing saved reward configuration.")?;
                reward.validate(&b.status)?;
                if config.escrow_address == reward.creator_wallet
                    || (reward.status == "awaiting_funding" && !b.submissions.is_empty())
                    || b.submissions
                        .iter()
                        .filter(|s| s.status == "approved")
                        .count()
                        != usize::from(reward.status == "paid")
                {
                    return Err("Invalid saved bounty reward.".into());
                }
            }
            for sub in &b.submissions {
                authenticated(sub.submitter)?;
                proof_url(&sub.proof_url)?;
                plain(&sub.note, 0, 1_000, true)?;
                if sub.id == 0
                    || sub.id > self.submission_sequence
                    || !["pending", "approved", "rejected", "not_selected"]
                        .contains(&sub.status.as_str())
                {
                    return Err("Invalid stored submission state.".into());
                }
                match (&b.reward, &sub.payout_wallet) {
                    (None, None) => {}
                    (Some(_), Some(wallet)) if rewards::wallet(wallet).as_ref() == Ok(wallet) => {}
                    _ => return Err("Invalid saved submission payout wallet.".into()),
                }
            }
        }
        Ok(())
    }
}

pub fn snapshot() -> Vec<u8> {
    BOARD.with_borrow(|b| {
        b.check_bounds().expect("validate Bounties v1 bounds");
        let bytes = candid::encode_one(b).expect("encode Bounties v1");
        assert!(
            bytes.len() <= MAX_SNAPSHOT_BYTES,
            "Bounties v1 snapshot exceeds maximum"
        );
        bytes
    })
}
pub fn restore(bytes: Option<Vec<u8>>) {
    let board: Board = bytes
        .map(|b| {
            assert!(
                b.len() <= MAX_SNAPSHOT_BYTES,
                "Bounties v1 snapshot exceeds maximum"
            );
            candid::decode_one(&b).expect("decode Bounties v1 without discarding records")
        })
        .unwrap_or_default();
    board.check_bounds().expect("validate restored Bounties v1");
    BOARD.with_borrow_mut(|b| *b = board);
}
fn request_guard() -> Result<(), String> {
    authenticated(ic_cdk::api::msg_caller())?;
    if ic0::msg_arg_data_size() > MAX_ARGUMENT_BYTES {
        return Err("Bounty request is too large.".into());
    }
    Ok(())
}
fn controller_guard() -> Result<(), String> {
    request_guard()?;
    if !ic_cdk::api::is_controller(&ic_cdk::api::msg_caller()) {
        return Err("Only a canister controller can perform this board action.".into());
    }
    Ok(())
}
pub fn inspect(method: &str) -> Result<(), String> {
    match method {
        "bounty_create"
        | "bounty_submit"
        | "bounty_review"
        | "bounty_cancel"
        | "bounty_prepare_reward"
        | "bounty_submit_reward" => {
            request_guard()?;
            // A cheap, nonmutating rejection before argument decoding. Update
            // handlers repeat the authoritative limits after validation, so
            // inter-canister calls and ingress races cannot bypass them.
            BOARD.with_borrow(|b| {
                b.check_rate(ic_cdk::api::msg_caller(), now(), method == "bounty_create")
            })
        }
        "bounty_sync_reward" => request_guard(),
        "bounty_moderate" | "bounty_configure_reward_escrow" => controller_guard(),
        _ => Ok(()),
    }
}
#[ic_cdk::query]
fn bounty_list(cursor: Option<u64>, limit: u32) -> BountyPage {
    BOARD.with_borrow(|b| b.list(cursor, limit))
}
#[ic_cdk::query]
fn bounty_get(id: u64) -> Option<Bounty> {
    BOARD.with_borrow(|b| b.visible(id).ok().cloned())
}
#[ic_cdk::query]
fn bounty_reward_config() -> Option<BountyRewardConfig> {
    BOARD.with_borrow(|b| b.reward_config.clone())
}
#[ic_cdk::update(guard = "request_guard")]
fn bounty_create(input: BountyInput) -> Result<Bounty, String> {
    BOARD.with_borrow_mut(|b| b.create(ic_cdk::api::msg_caller(), input, now()))
}
#[ic_cdk::update(guard = "request_guard")]
fn bounty_submit(id: u64, proof_url: String, note: String) -> Result<Bounty, String> {
    BOARD.with_borrow_mut(|b| b.submit(ic_cdk::api::msg_caller(), id, proof_url, note, now()))
}
#[ic_cdk::update(guard = "request_guard")]
fn bounty_prepare_reward(
    id: u64,
    creator_wallet: String,
    amount_wei: String,
) -> Result<Bounty, String> {
    let reward = BountyReward::new(
        ic_cdk::api::canister_self(),
        id,
        &creator_wallet,
        &amount_wei,
    )?;
    BOARD.with_borrow_mut(|b| b.prepare_reward(ic_cdk::api::msg_caller(), id, reward, now()))
}
#[ic_cdk::update(guard = "request_guard")]
fn bounty_submit_reward(
    id: u64,
    proof_url: String,
    note: String,
    payout_wallet: String,
) -> Result<Bounty, String> {
    let wallet = rewards::wallet(&payout_wallet)?;
    BOARD.with_borrow_mut(|b| {
        b.submit_proof(
            ic_cdk::api::msg_caller(),
            id,
            proof_url,
            note,
            Some(wallet),
            now(),
        )
    })
}
#[ic_cdk::update(guard = "request_guard")]
async fn bounty_sync_reward(id: u64, tx_hash: String) -> Result<Bounty, String> {
    let caller = ic_cdk::api::msg_caller();
    let tx_hash = rewards::tx_hash(&tx_hash)?;
    let (config, bounty) = BOARD.with_borrow(|b| -> Result<_, String> {
        Ok((
            b.reward_config
                .clone()
                .ok_or("Rewards are not enabled on this board.")?,
            b.sync_bounty(caller, id)?.clone(),
        ))
    })?;
    let reward = bounty
        .reward
        .as_ref()
        .ok_or("This bounty has no reward setup.")?;
    if bounty.status != "open" {
        if reward.tx_hash.as_ref() == Some(&tx_hash) {
            return Ok(bounty);
        }
        return Err("This bounty's reward already has a final receipt.".into());
    }
    let at = now();
    let lease = SyncLease::acquire(id, caller, at)?;
    BOARD.with_borrow_mut(|b| b.admit_sync(caller, id, at))?;
    let receipt = rewards::read_receipt(&config, reward, &tx_hash).await?;
    lease.recheck(reward)?;
    BOARD.with_borrow(|b| b.check_action(caller, id, reward, &receipt.action))?;
    rewards::check_finalized(&receipt).await?;
    lease.recheck(reward)?;
    rewards::check_canonical(&receipt).await?;
    lease.recheck(reward)?;
    if matches!(receipt.action, RewardAction::Funded { .. }) {
        rewards::check_funded(&config, reward).await?;
        lease.recheck(reward)?;
    }
    BOARD.with_borrow_mut(|b| b.apply_reward(caller, id, reward, receipt.action, tx_hash, now()))
}
#[ic_cdk::update(guard = "request_guard")]
fn bounty_review(id: u64, submission_id: u64, approve: bool) -> Result<Bounty, String> {
    BOARD
        .with_borrow_mut(|b| b.review(ic_cdk::api::msg_caller(), id, submission_id, approve, now()))
}
#[ic_cdk::update(guard = "request_guard")]
fn bounty_cancel(id: u64) -> Result<Bounty, String> {
    BOARD.with_borrow_mut(|b| b.cancel(ic_cdk::api::msg_caller(), id, now()))
}
#[ic_cdk::update(guard = "controller_guard")]
fn bounty_moderate(id: u64, hidden: bool) -> Result<(), String> {
    BOARD.with_borrow_mut(|b| b.moderate(id, hidden))
}
#[ic_cdk::update(guard = "controller_guard")]
fn bounty_configure_reward_escrow(escrow_address: String) -> Result<BountyRewardConfig, String> {
    BOARD.with_borrow_mut(|b| b.configure_reward(&escrow_address))
}

#[cfg(test)]
mod tests {
    use super::*;
    const CREATOR_WALLET: &str = "0x1111111111111111111111111111111111111111";
    const ESCROW: &str = "0x2222222222222222222222222222222222222222";
    const PAYOUT_WALLET: &str = "0x3333333333333333333333333333333333333333";
    const TX: &str = "0x4444444444444444444444444444444444444444444444444444444444444444";
    const PAY_TX: &str = "0x5555555555555555555555555555555555555555555555555555555555555555";
    fn person(n: u8) -> Principal {
        Principal::self_authenticating([n; 32])
    }
    fn input() -> BountyInput {
        BountyInput {
            title: "Check a deployment".into(),
            description: "Publish a source-backed deployment analysis.".into(),
            category: "research".into(),
            deadline: None,
        }
    }
    fn proof() -> String {
        "https://github.com/Gh0stllm/GH0ST/issues/1".into()
    }
    #[test]
    fn rewards_require_confirmed_funding_and_exact_payment_for_approval() {
        let mut b = Board::default();
        let owner = person(1);
        let hunter = person(2);
        let id = b.create(owner, input(), 0).unwrap().id;
        let reward = BountyReward::new(person(3), id, CREATOR_WALLET, "50").unwrap();
        assert!(b.prepare_reward(owner, id, reward.clone(), MINUTE).is_err());
        b.configure_reward(ESCROW).unwrap();
        assert!(b.configure_reward(PAYOUT_WALLET).is_err());
        assert!(b
            .prepare_reward(hunter, id, reward.clone(), MINUTE)
            .is_err());
        b.prepare_reward(owner, id, reward.clone(), MINUTE).unwrap();
        assert!(b.submit(hunter, id, proof(), "".into(), MINUTE).is_err());
        assert!(b
            .submit_proof(
                hunter,
                id,
                proof(),
                "".into(),
                Some(PAYOUT_WALLET.into()),
                MINUTE
            )
            .is_err());
        assert!(b.cancel(owner, id, 2 * MINUTE).is_err());
        let funded = RewardAction::Funded {
            amount: "50".into(),
        };
        assert!(b.check_action(hunter, id, &reward, &funded).is_err());
        assert!(b
            .check_action(
                owner,
                id,
                &reward,
                &RewardAction::Funded {
                    amount: "51".into()
                }
            )
            .is_err());
        let live = b
            .apply_reward(owner, id, &reward, funded, TX.into(), 2 * MINUTE)
            .unwrap()
            .reward
            .unwrap();
        assert!(b.check_sync(owner, id, &reward).is_err());
        assert!(b
            .submit(hunter, id, proof(), "".into(), 3 * MINUTE)
            .is_err());
        let sid = b
            .submit_proof(
                hunter,
                id,
                proof(),
                "".into(),
                Some(PAYOUT_WALLET.into()),
                3 * MINUTE,
            )
            .unwrap()
            .submissions[0]
            .id;
        assert!(b.review(owner, id, sid, true, 4 * MINUTE).is_err());
        let funded_board = candid::encode_one(&b).unwrap();
        for (amount, submission_id, recipient) in [
            ("51", sid, PAYOUT_WALLET),
            ("50", sid + 1, PAYOUT_WALLET),
            ("50", sid, CREATOR_WALLET),
        ] {
            let mut copy: Board = candid::decode_one(&funded_board).unwrap();
            let unmatched = copy
                .apply_reward(
                    owner,
                    id,
                    &live,
                    RewardAction::Paid {
                        amount: amount.into(),
                        submission_id,
                        recipient: recipient.into(),
                    },
                    PAY_TX.into(),
                    5 * MINUTE,
                )
                .unwrap();
            assert_eq!(unmatched.status, "cancelled");
            assert_eq!(unmatched.submissions[0].status, "not_selected");
            let reward = unmatched.reward.unwrap();
            assert_eq!(reward.status, "paid_unmatched");
            assert_eq!(reward.tx_hash.as_deref(), Some(PAY_TX));
            assert!(copy.check_sync(owner, id, &live).is_err());
            copy.check_bounds().unwrap();
        }
        b.review(owner, id, sid, false, 4 * MINUTE).unwrap();
        let payment = RewardAction::Paid {
            amount: "50".into(),
            submission_id: sid,
            recipient: PAYOUT_WALLET.into(),
        };
        let paid = b
            .apply_reward(owner, id, &live, payment, PAY_TX.into(), 5 * MINUTE)
            .unwrap();
        assert_eq!(paid.status, "completed");
        assert_eq!(paid.submissions[0].status, "approved");
        assert_eq!(paid.reward.unwrap().tx_hash.as_deref(), Some(PAY_TX));
        assert!(b
            .check_action(owner, id, &live, &RewardAction::Cancelled)
            .is_err());
        b.check_bounds().unwrap();
    }
    #[test]
    fn finalized_refund_can_close_an_unverified_or_hidden_offer() {
        let mut b = Board::default();
        b.configure_reward(ESCROW).unwrap();
        let owner = person(1);
        let id = b.create(owner, input(), 0).unwrap().id;
        let reward = BountyReward::new(person(3), id, CREATOR_WALLET, "50").unwrap();
        b.prepare_reward(owner, id, reward.clone(), MINUTE).unwrap();
        b.moderate(id, true).unwrap();
        let result = b
            .apply_reward(
                owner,
                id,
                &reward,
                RewardAction::Cancelled,
                TX.into(),
                2 * MINUTE,
            )
            .unwrap();
        assert_eq!(result.status, "cancelled");
        assert_eq!(result.reward.unwrap().status, "cancelled");
        assert!(b.visible(id).is_err());
        assert!(b.check_sync(owner, id, &reward).is_err());
        b.check_bounds().unwrap();
    }
    #[test]
    fn older_proof_board_snapshot_decodes_with_optional_reward_fields() {
        #[derive(CandidType)]
        struct OldSubmission {
            id: u64,
            submitter: Principal,
            proof_url: String,
            note: String,
            status: String,
            created_at: u64,
            reviewed_at: Option<u64>,
        }
        #[derive(CandidType)]
        struct OldBounty {
            id: u64,
            owner: Principal,
            title: String,
            description: String,
            category: String,
            deadline: Option<u64>,
            status: String,
            created_at: u64,
            updated_at: u64,
            submissions: Vec<OldSubmission>,
        }
        #[derive(CandidType)]
        struct OldStored {
            bounty: OldBounty,
            hidden: bool,
        }
        #[derive(CandidType)]
        struct OldBoard {
            bounties: BTreeMap<u64, OldStored>,
            bounty_sequence: u64,
            submission_sequence: u64,
            creates: Vec<(Principal, u64)>,
            writes: Vec<(Principal, u64)>,
        }
        let owner = person(1);
        let hunter = person(2);
        let input = input();
        let old = OldBoard {
            bounties: BTreeMap::from([(
                1,
                OldStored {
                    hidden: false,
                    bounty: OldBounty {
                        id: 1,
                        owner,
                        title: input.title,
                        description: input.description,
                        category: input.category,
                        deadline: None,
                        status: "open".into(),
                        created_at: 0,
                        updated_at: MINUTE,
                        submissions: vec![OldSubmission {
                            id: 1,
                            submitter: hunter,
                            proof_url: proof(),
                            note: "Existing proof".into(),
                            status: "pending".into(),
                            created_at: MINUTE,
                            reviewed_at: None,
                        }],
                    },
                },
            )]),
            bounty_sequence: 1,
            submission_sequence: 1,
            creates: vec![(owner, 0)],
            writes: vec![(owner, 0), (hunter, MINUTE)],
        };
        restore(Some(candid::encode_one(&old).unwrap()));
        BOARD.with_borrow_mut(|board| {
            assert!(board.reward_config.is_none() && board.reward_syncs.is_none());
            let bounty = board.visible(1).unwrap();
            assert!(bounty.reward.is_none() && bounty.submissions[0].payout_wallet.is_none());
            assert_eq!(bounty.submissions[0].note, "Existing proof");
            assert!(board.review(owner, 1, 1, true, 2 * MINUTE).is_ok());
        });
    }
    #[test]
    fn permissions_and_lifecycle_are_enforced_by_caller() {
        let mut b = Board::default();
        assert!(b.create(Principal::anonymous(), input(), 0).is_err());
        let created = b.create(person(1), input(), 0).unwrap();
        assert!(b
            .submit(person(1), created.id, proof(), "".into(), MINUTE)
            .is_err());
        let first = b
            .submit(
                person(2),
                created.id,
                proof(),
                "Method and evidence".into(),
                MINUTE,
            )
            .unwrap();
        let sid = first.submissions[0].id;
        assert!(b
            .submit(person(2), created.id, proof(), "".into(), 2 * MINUTE)
            .is_err());
        assert!(b
            .review(person(2), created.id, sid, true, 2 * MINUTE)
            .is_err());
        assert!(b.cancel(person(2), created.id, 2 * MINUTE).is_err());
        b.submit(person(3), created.id, proof(), "".into(), 2 * MINUTE)
            .unwrap();
        let done = b
            .review(person(1), created.id, sid, true, 3 * MINUTE)
            .unwrap();
        assert_eq!(done.status, "completed");
        assert_eq!(done.submissions[0].status, "approved");
        assert_eq!(done.submissions[1].status, "not_selected");
        assert!(b
            .review(person(1), created.id, sid, false, 4 * MINUTE)
            .is_err());
        assert!(b
            .submit(person(4), created.id, proof(), "".into(), 4 * MINUTE)
            .is_err());
        assert!(b.cancel(person(1), created.id, 4 * MINUTE).is_err());
    }
    #[test]
    fn rejection_and_cancellation_do_not_approve_or_pay() {
        let mut b = Board::default();
        b.create(person(1), input(), 0).unwrap();
        let s = b.submit(person(2), 1, proof(), "".into(), MINUTE).unwrap();
        let reviewed = b
            .review(person(1), 1, s.submissions[0].id, false, 2 * MINUTE)
            .unwrap();
        assert_eq!(reviewed.status, "open");
        assert_eq!(reviewed.submissions[0].status, "rejected");
        b.submit(person(3), 1, proof(), "".into(), 3 * MINUTE)
            .unwrap();
        let closed = b.cancel(person(1), 1, 4 * MINUTE).unwrap();
        assert_eq!(closed.status, "cancelled");
        assert_eq!(closed.submissions[0].status, "rejected");
        assert_eq!(closed.submissions[1].status, "not_selected");
        assert!(closed.submissions.iter().all(|s| s.reviewed_at.is_some()));
    }
    #[test]
    fn links_and_plain_text_reject_unsafe_and_unbounded_inputs() {
        for url in [
            "javascript:alert(1)",
            "http://example.com",
            "https://user@example.com/path",
            "https://example.com:443/",
            "https://127.0.0.1/",
            "https://localhost/",
            "https://example.local/",
            "https://example.com\\@evil.com",
            "https://example.com/<script>",
            "https://example.com/hello world",
            "https://ｅxample.com",
            "https://.com/",
            "https://a..com/",
        ] {
            assert!(proof_url(url).is_err(), "accepted {url}");
        }
        assert!(proof_url(&format!("https://example.com/{}", "x".repeat(1_024))).is_err());
        assert!(proof_url("https://robinhoodchain.blockscout.com/tx/0x123#logs").is_ok());
        for title in ["x", "<script>", "a\nb"] {
            let mut c = input();
            c.title = title.into();
            assert!(validate_input(c, 0).is_err());
        }
        let mut c = input();
        c.description = "a".repeat(4_001);
        assert!(validate_input(c, 0).is_err());
        assert!(plain("<img src=x>", 0, 1_000, true).is_err());
        assert!(plain("Method\n\tEvidence", 0, 1_000, true).is_ok());
    }
    #[test]
    fn deadline_blocks_late_proofs_but_preserves_owner_review() {
        let mut b = Board::default();
        let mut c = input();
        c.deadline = Some(2 * MINUTE);
        assert!(validate_input(c.clone(), 2 * MINUTE).is_err());
        b.create(person(1), c, 0).unwrap();
        let s = b.submit(person(2), 1, proof(), "".into(), MINUTE).unwrap();
        assert!(b
            .submit(person(3), 1, proof(), "".into(), 2 * MINUTE)
            .is_err());
        assert!(b
            .review(person(1), 1, s.submissions[0].id, true, 3 * MINUTE)
            .is_ok());
    }
    #[test]
    fn pagination_is_stable_across_hidden_records_and_new_inserts() {
        let mut b = Board::default();
        for i in 1..=5 {
            b.create(person(i), input(), u64::from(i) * MINUTE).unwrap();
        }
        b.moderate(4, true).unwrap();
        assert!(b.visible(4).is_err());
        assert!(b
            .submit(person(9), 4, proof(), "".into(), 6 * MINUTE)
            .is_err());
        let first = b.list(None, 2);
        assert_eq!(
            first.items.iter().map(|b| b.id).collect::<Vec<_>>(),
            vec![5, 3]
        );
        assert_eq!(first.next, Some(3));
        b.create(person(6), input(), 6 * MINUTE).unwrap();
        let second = b.list(first.next, 2);
        assert_eq!(
            second.items.iter().map(|b| b.id).collect::<Vec<_>>(),
            vec![2, 1]
        );
        assert_eq!(second.next, None);
        assert!(b.list(Some(0), 20).items.is_empty());
        assert_eq!(b.list(None, 0).items.len(), 1);
        b.moderate(4, false).unwrap();
        assert!(b.visible(4).is_ok());
    }
    #[test]
    fn capacities_and_rate_limits_do_not_discard_records() {
        let mut b = Board::default();
        b.create(person(1), input(), 0).unwrap();
        assert!(b.create(person(1), input(), 10 * SECOND).is_err());
        for i in 1..8 {
            b.create(person(1), input(), i * MINUTE).unwrap();
        }
        assert!(b.create(person(1), input(), 8 * MINUTE).is_err());
        for i in 2..=17 {
            b.submit(person(i), 1, proof(), "".into(), u64::from(i) * MINUTE)
                .unwrap();
        }
        assert!(b
            .submit(person(18), 1, proof(), "".into(), 18 * MINUTE)
            .is_err());
        let mut limited = Board::default();
        limited.writes = (0..20).map(|i| (person(i), 0)).collect();
        assert!(limited.create(person(30), input(), 59 * SECOND).is_err());
        assert!(limited.create(person(30), input(), MINUTE).is_ok());
        let mut limited = Board::default();
        limited.creates = (0..30).map(|i| (person(i), 0)).collect();
        assert!(limited.create(person(40), input(), MINUTE).is_err());
        assert!(limited.create(person(40), input(), HOUR).is_ok());
        b.check_bounds().unwrap();
    }
    #[test]
    fn ingress_rate_prefilter_is_nonmutating_and_agrees_at_window_edges() {
        let mut b = Board::default();
        b.admit(person(1), 0, true).unwrap();
        let bytes = candid::encode_one(&b).unwrap();
        assert!(b.check_rate(person(1), 9 * SECOND, false).is_err());
        assert!(b.check_rate(person(1), 10 * SECOND, false).is_ok());
        assert!(b.check_rate(person(1), 59 * SECOND, true).is_err());
        assert!(b.check_rate(person(1), MINUTE, true).is_ok());
        assert_eq!(candid::encode_one(&b).unwrap(), bytes);
        b.writes = (0..240).map(|_| (person(2), 0)).collect();
        assert!(b.check_rate(person(3), MINUTE, false).is_err());
        assert!(b.check_rate(person(3), HOUR, false).is_ok());
        b.writes.clear();
        b.creates = (0..100).map(|_| (person(2), 0)).collect();
        assert!(b.check_rate(person(3), HOUR, true).is_err());
        assert!(b.check_rate(person(3), DAY, true).is_ok());
    }
    #[test]
    fn board_capacity_counts_closed_and_hidden_records_without_eviction() {
        let mut b = Board::default();
        for i in 0..MAX_BOUNTIES {
            b.create(person(i as u8), input(), i as u64 * HOUR).unwrap();
        }
        b.moderate(1, true).unwrap();
        b.cancel(person(1), 2, MAX_BOUNTIES as u64 * HOUR).unwrap();
        assert!(b
            .create(person(3), input(), (MAX_BOUNTIES as u64 + 1) * HOUR)
            .is_err());
        assert_eq!(b.bounties.len(), MAX_BOUNTIES);
        assert!(b.bounties[&1].hidden);
        assert_eq!(b.bounties[&2].bounty.status, "cancelled");
    }
    #[test]
    fn durable_board_roundtrip_preserves_content_hidden_state_and_limits() {
        let mut b = Board::default();
        b.create(person(1), input(), 0).unwrap();
        b.submit(
            person(2),
            1,
            proof(),
            "Source-backed evidence".into(),
            MINUTE,
        )
        .unwrap();
        b.moderate(1, true).unwrap();
        BOARD.with_borrow_mut(|current| *current = b);
        let bytes = snapshot();
        restore(None);
        assert!(BOARD.with_borrow(|b| b.bounties.is_empty()));
        restore(Some(bytes.clone()));
        assert_eq!(snapshot(), bytes);
        BOARD.with_borrow(|b| {
            assert!(b.visible(1).is_err());
            assert_eq!(
                b.bounties[&1].bounty.submissions[0].note,
                "Source-backed evidence"
            );
            assert_eq!(b.writes.len(), 2);
        });
    }
    #[test]
    #[should_panic(expected = "decode Bounties v1 without discarding records")]
    fn corrupt_existing_state_fails_closed() {
        restore(Some(vec![1, 2, 3]));
    }
}
