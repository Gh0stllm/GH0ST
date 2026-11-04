//! Owner-scoped projects. A run reads one existing public Watcher report.
//! The registry cannot initiate scans, pay tokens, or invoke the model.
use candid::{CandidType, Deserialize, Principal};
use ic_cdk::call::Call;
use ic_management_canister_types::{
    HttpMethod, HttpRequestArgs, HttpRequestResult, TransformArgs, TransformContext, TransformFunc,
};
use serde::Serialize;
use serde_json::Value;
use std::{cell::RefCell, collections::BTreeMap};

const MINUTE: u64 = 60_000;
const HOUR: u64 = 60 * MINUTE;
const DAY: u64 = 24 * HOUR;
const LEASE: u64 = 2 * MINUTE;
const MAX_PROJECTS: usize = 256;
const MAX_ACTIVITY: usize = 8;
const FLOOR: u128 = 120_000_000_000;
const MAX_RESPONSE: u64 = 65_536;
const ORIGIN: &str = "https://gh0st-observatory.netlify.app/.netlify/functions/watcher-scans?network=mainnet&address=";
const PLATFORM: &str = "0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559";
const TRANSFORM: &str = "spawn_transform";
const RULES: [(&str, &str); 6] = [
    ("mint", "Ordinary-account mint"),
    ("underflow", "Balance underflow"),
    ("withdraw", "Withdrawal reentry"),
    ("authorization", "Origin-based payment"),
    ("replay", "Signed coupon replay"),
    ("token", "Credit on failed transfer"),
];

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct SpawnConfig {
    pub name: String,
    pub personality: String,
    pub addresses: Vec<String>,
    pub tools: Vec<String>,
    pub daily_cap: u32,
}
#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct SpawnActivity {
    pub id: u64,
    pub at: u64,
    pub address: String,
    pub status: String,
    pub source_block: Option<u64>,
    pub source_at: Option<u64>,
    pub lines: Vec<String>,
    pub fee: u32,
}
#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct SpawnProject {
    pub owner: Principal,
    pub config: SpawnConfig,
    pub created_at: u64,
    pub updated_at: u64,
    pub activity: Vec<SpawnActivity>,
}
#[derive(CandidType, Deserialize, Default)]
struct Registry {
    projects: BTreeMap<Principal, SpawnProject>,
    sequence: u64,
    starts: Vec<u64>,
    creates: Vec<u64>,
    saves: Vec<u64>,
}
thread_local! { static REGISTRY:RefCell<Registry>=RefCell::default(); }
fn now() -> u64 {
    ic_cdk::api::time() / 1_000_000
}
fn check_owner(owner: Principal) -> Result<(), String> {
    if owner == Principal::anonymous() || owner == Principal::management_canister() {
        return Err("Sign in to manage your project.".into());
    }
    Ok(())
}
fn address(s: &str) -> Result<String, String> {
    if s.len() != 42
        || !s.starts_with("0x")
        || !s.as_bytes()[2..].iter().all(u8::is_ascii_hexdigit)
        || s.as_bytes()[2..].iter().all(|&b| b == b'0')
    {
        return Err("Enter a nonzero 0x contract address on Robinhood mainnet.".into());
    }
    Ok(s.to_ascii_lowercase())
}
fn validate(mut c: SpawnConfig) -> Result<SpawnConfig, String> {
    c.name = c.name.trim().to_owned();
    if c.name.is_empty() || c.name.len() > 40 || c.name.chars().any(char::is_control) {
        return Err(
            "The project name must be 1 to 40 UTF-8 bytes with no control characters.".into(),
        );
    }
    if !["analyst", "sentinel", "guide"].contains(&c.personality.as_str()) {
        return Err("Unsupported personality.".into());
    }
    if c.daily_cap > 1_000_000 {
        return Err("The daily cap cannot exceed 1,000,000 whole GH0ST.".into());
    }
    if c.addresses.is_empty() || c.addresses.len() > 4 {
        return Err("Choose one to four watched addresses.".into());
    }
    for a in &mut c.addresses {
        *a = address(a)?;
    }
    if c.tools.is_empty()
        || c.tools.len() > 3
        || c.tools
            .iter()
            .any(|t| !["checks", "deployer", "coverage"].contains(&t.as_str()))
    {
        return Err("Choose one or more supported tools.".into());
    }
    if [&c.addresses, &c.tools]
        .into_iter()
        .any(|v| v.iter().enumerate().any(|(i, x)| v[..i].contains(x)))
    {
        return Err("Each address and tool must be unique.".into());
    }
    Ok(c)
}
fn within(times: &[u64], at: u64, period: u64) -> usize {
    times
        .iter()
        .filter(|&&x| at.saturating_sub(x) < period)
        .count()
}
fn pending(p: &SpawnProject) -> bool {
    p.activity.first().is_some_and(|a| a.status == "pending")
}
fn unwind(a: &mut SpawnActivity) {
    a.status = "unavailable".into();
    a.lines = vec!["The report read was interrupted before a result was recorded.".into()];
}

impl Registry {
    fn recover(&mut self, at: u64, upgrade: bool) {
        for p in self.projects.values_mut() {
            if let Some(a) = p.activity.first_mut() {
                if a.status == "pending" && (upgrade || at.saturating_sub(a.at) >= LEASE) {
                    unwind(a);
                }
            }
        }
    }
    fn save(&mut self, owner: Principal, c: SpawnConfig, at: u64) -> Result<SpawnProject, String> {
        check_owner(owner)?;
        let c = validate(c)?;
        self.recover(at, false);
        self.saves.retain(|&x| at.saturating_sub(x) < HOUR);
        if self.saves.len() >= 120 {
            return Err("The registry save limit is in use. Try again later.".into());
        }
        if let Some(p) = self.projects.get_mut(&owner) {
            if pending(p) {
                return Err("Wait until the current run finishes before editing.".into());
            }
            if at.saturating_sub(p.updated_at) < MINUTE {
                return Err("Wait one minute between project saves.".into());
            }
            p.config = c;
            p.updated_at = at;
        } else {
            self.creates.retain(|&x| at.saturating_sub(x) < DAY);
            if self.projects.len() >= MAX_PROJECTS {
                return Err("The project registry is full.".into());
            }
            if within(&self.creates, at, HOUR) >= 8 || self.creates.len() >= 32 {
                return Err("New project registrations are temporarily at capacity.".into());
            }
            self.projects.insert(
                owner,
                SpawnProject {
                    owner,
                    config: c,
                    created_at: at,
                    updated_at: at,
                    activity: vec![],
                },
            );
            self.creates.push(at);
        }
        self.saves.push(at);
        Ok(self.projects[&owner].clone())
    }
    fn begin(
        &mut self,
        owner: Principal,
        addr: &str,
        at: u64,
    ) -> Result<(SpawnConfig, u64), String> {
        check_owner(owner)?;
        self.recover(at, false);
        let p = self
            .projects
            .get(&owner)
            .ok_or("Create your own project before running it.")?;
        if !p.config.addresses.iter().any(|a| a == addr) {
            return Err("This address is outside your project's watchlist.".into());
        }
        if pending(p) {
            return Err("Your project already has a run in progress.".into());
        }
        if p.activity
            .first()
            .is_some_and(|a| at.saturating_sub(a.at) < MINUTE)
        {
            return Err("Wait one minute between runs.".into());
        }
        self.starts.retain(|&x| at.saturating_sub(x) < DAY);
        if self.projects.values().filter(|p| pending(p)).count() >= 2
            || within(&self.starts, at, HOUR) >= 12
            || self.starts.len() >= 40
        {
            return Err("Shared report-reading capacity is in use. Try again later.".into());
        }
        self.sequence = self
            .sequence
            .checked_add(1)
            .ok_or("Run counter exhausted.")?;
        self.starts.push(at);
        let p = self.projects.get_mut(&owner).unwrap();
        // All tools currently cost zero GH0ST, which is admissible even for a zero cap.
        p.activity.insert(
            0,
            SpawnActivity {
                id: self.sequence,
                at,
                address: addr.into(),
                status: "pending".into(),
                source_block: None,
                source_at: None,
                lines: vec![],
                fee: 0,
            },
        );
        p.activity.truncate(MAX_ACTIVITY);
        Ok((p.config.clone(), self.sequence))
    }
    fn finish(
        &mut self,
        owner: Principal,
        id: u64,
        outcome: Result<Source, &str>,
        config: &SpawnConfig,
    ) -> Result<SpawnActivity, String> {
        let a = self
            .projects
            .get_mut(&owner)
            .and_then(|p| p.activity.first_mut())
            .filter(|a| a.id == id && a.status == "pending")
            .ok_or("This run has already expired.")?;
        match outcome {
            Ok(s) => {
                a.source_at = Some(s.time);
                a.source_block = s.block;
                a.status = if s.block.is_some() {
                    "complete"
                } else {
                    "platform"
                }
                .into();
                a.lines = s.lines(config);
            }
            Err(reason) => {
                a.status = "unavailable".into();
                a.lines = vec![reason.into()];
            }
        }
        Ok(a.clone())
    }
}

pub fn snapshot() -> Vec<u8> {
    REGISTRY.with_borrow(|r| candid::encode_one(r).expect("encode Spawn registry v1"))
}
pub fn restore(bytes: Option<Vec<u8>>) {
    let mut r: Registry = bytes
        .map(|b| candid::decode_one(&b).expect("decode Spawn registry v1"))
        .unwrap_or_default();
    r.recover(0, true);
    REGISTRY.with_borrow_mut(|s| *s = r);
}

fn owner_payload_guard() -> Result<(), String> {
    // Also applies to inter-canister updates. No untrusted Candid collection is
    // decoded before the raw argument size and the caller have been checked.
    check_owner(ic_cdk::api::msg_caller())?;
    if ic0::msg_arg_data_size() > 2048 {
        return Err("Project request is too large.".into());
    }
    Ok(())
}
fn transform_guard() -> Result<(), String> {
    if ic_cdk::api::msg_caller() != Principal::management_canister() {
        return Err("Only the IC HTTPS adapter can transform a response.".into());
    }
    Ok(())
}
#[ic_cdk::inspect_message]
fn inspect_ingress() {
    let method = ic_cdk::api::msg_method_name();
    if matches!(method.as_str(), "spawn_save" | "spawn_run") && owner_payload_guard().is_err() {
        return;
    }
    ic_cdk::api::accept_message();
}

#[ic_cdk::update(guard = "owner_payload_guard")]
fn spawn_save(config: SpawnConfig) -> Result<SpawnProject, String> {
    REGISTRY.with_borrow_mut(|r| r.save(ic_cdk::api::msg_caller(), config, now()))
}
#[ic_cdk::query]
fn spawn_get(owner: Principal) -> Option<SpawnProject> {
    REGISTRY.with_borrow(|r| {
        r.projects.get(&owner).cloned().map(|mut p| {
            if let Some(a) = p.activity.first_mut() {
                if a.status == "pending" && now().saturating_sub(a.at) >= LEASE {
                    unwind(a)
                }
            }
            p
        })
    })
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Source {
    time: u64,
    block: Option<u64>,
    rules: Option<Vec<u8>>,
    sender: Option<String>,
    prior: Option<u8>,
}
impl Source {
    fn lines(&self, c: &SpawnConfig) -> Vec<String> {
        if self.block.is_none() {
            return vec!["GH0ST Watch: We own and trust this token.".into()];
        }
        let mut out = vec![];
        for t in &c.tools {
            match t.as_str() {
                "checks" => {
                    if let Some(results) = &self.rules {
                        let mut ids: Vec<usize> = (0..RULES.len()).collect();
                        if c.personality == "sentinel" {
                            ids.sort_by_key(|&i| match results[i] {
                                1 => 0,
                                2 => 1,
                                _ => 2,
                            });
                        }
                        for i in ids {
                            out.push(format!(
                                "{}: {}.",
                                RULES[i].1,
                                ["not reproduced", "reproduced", "untested"][results[i] as usize]
                            ));
                        }
                    } else {
                        out.push("The saved report has no complete six-rule result.".into());
                    }
                }
                "coverage" => {
                    if let Some(results) = &self.rules {
                        let tested = results.iter().filter(|&&r| r != 2).count();
                        out.push(format!("{tested} of 6 behavior checks ran at the saved block. {} remained untested.",6-tested));
                        if c.personality == "guide" {
                            out.push(
                                "An untested rule gives no result about that behavior.".into(),
                            );
                        }
                    } else {
                        out.push("The saved report has no reliable coverage breakdown.".into());
                    }
                }
                "deployer" => {
                    out.push(
                        self.sender
                            .as_ref()
                            .map(|s| format!("Deployment transaction sender: {s}."))
                            .unwrap_or_else(|| "The deployment sender was unavailable.".into()),
                    );
                    out.push(self.prior.map(|n|format!("Earlier deployments attributed to that sender in the saved sample: {n}.")).unwrap_or_else(||"Earlier sender deployments could not be established from the saved sample.".into()));
                }
                _ => unreachable!("validated tool"),
            }
        }
        out
    }
}
fn project(raw: &[u8], target: &str) -> Option<Source> {
    let root: Value = serde_json::from_slice(raw).ok()?;
    let e = &root["entry"];
    if e["network"] != "mainnet" || address(e["address"].as_str()?).ok()? != target {
        return None;
    }
    let time = e["scannedAt"].as_u64().filter(|&t| t > 0)?;
    let mut s = Source {
        time,
        block: None,
        rules: None,
        sender: None,
        prior: None,
    };
    let report = e.get("report")?;
    if report.is_null() {
        return (target == PLATFORM).then_some(s);
    }
    if report["network"] != "mainnet" || address(report["address"].as_str()?).ok()? != target {
        return None;
    }
    s.block = Some(report["block"].as_u64()?);
    let hash = report["blockHash"].as_str()?;
    if hash.len() != 66
        || !hash.starts_with("0x")
        || !hash.as_bytes()[2..].iter().all(u8::is_ascii_hexdigit)
    {
        return None;
    }
    s.rules = report["rules"]
        .as_array()
        .filter(|v| v.len() == RULES.len())
        .and_then(|v| {
            RULES
                .iter()
                .map(|(k, _)| {
                    let r = v.iter().find(|r| r["key"] == *k)?;
                    match r["status"].as_str()? {
                        "Not reproduced" => Some(0),
                        "Reproduced" => Some(1),
                        "Untested" => Some(2),
                        _ => None,
                    }
                })
                .collect()
        });
    let origin = &e["details"]["intel"]["origin"];
    s.sender = origin["wallet"].as_str().and_then(|a| address(a).ok());
    let history = &origin["history"];
    if s.sender.is_some() {
        s.prior = history["items"]
            .as_array()
            .filter(|v| v.len() <= 10)
            .and_then(|items| {
                let n = items
                    .iter()
                    .filter(|i| {
                        matches!(
                            i["kind"].as_str(),
                            Some("Wallet creation" | "Same wallet via factory")
                        )
                    })
                    .count();
                (n > 0 || history["direct"].is_number() || history["internal"].is_number())
                    .then_some(n as u8)
            });
    }
    Some(s)
}

#[ic_cdk::query(guard = "transform_guard")]
fn spawn_transform(args: TransformArgs) -> HttpRequestResult {
    canonical_response(args)
}
fn canonical_response(mut args: TransformArgs) -> HttpRequestResult {
    // No server Date, cookies, trace IDs, or unrelated report fields enter consensus.
    let r = &mut args.response;
    r.headers.clear();
    if r.status == 200u16 {
        let s = std::str::from_utf8(&args.context)
            .ok()
            .and_then(|s| address(s).ok())
            .and_then(|a| project(&r.body, &a));
        if let Some(s) = s {
            r.body = serde_json::to_vec(&s).expect("serialize bounded source");
        } else {
            r.status = 502u16.into();
            r.body.clear();
        }
    } else {
        r.body.clear();
    }
    args.response
}
fn request(addr: &str, canister: Principal) -> HttpRequestArgs {
    HttpRequestArgs {
        url: format!("{ORIGIN}{addr}"),
        max_response_bytes: Some(MAX_RESPONSE),
        method: HttpMethod::GET,
        headers: vec![],
        body: None,
        transform: Some(TransformContext {
            function: TransformFunc::new(canister, TRANSFORM.into()),
            context: addr.as_bytes().into(),
        }),
    }
}
#[ic_cdk::update(guard = "owner_payload_guard")]
async fn spawn_run(addr: String) -> Result<SpawnActivity, String> {
    let owner = ic_cdk::api::msg_caller();
    check_owner(owner)?;
    let addr = address(&addr)?;
    let req = request(&addr, ic_cdk::api::canister_self());
    let request_bytes = (req.url.len() + TRANSFORM.len() + addr.len()) as u64;
    let cost = ic_cdk::api::cost_http_request(request_bytes, MAX_RESPONSE);
    if ic_cdk::api::canister_cycle_balance() < FLOOR + cost || cost > 2_500_000_000 {
        return Err(
            "The checker is preserving its cycle reserve. Try again after capacity is restored."
                .into(),
        );
    }
    let (config, id) = REGISTRY.with_borrow_mut(|r| r.begin(owner, &addr, now()))?;
    let response = Call::bounded_wait(Principal::management_canister(), "http_request")
        .change_timeout(45)
        .with_cycles(cost)
        .with_arg(&req)
        .await;
    let outcome = match response
        .ok()
        .and_then(|r| r.candid::<HttpRequestResult>().ok())
    {
        Some(r) if r.status == 200u16 => serde_json::from_slice(&r.body)
            .map_err(|_| "The saved Watcher report could not be read."),
        Some(r) if r.status == 404u16 => {
            Err("There is no saved mainnet report for this address. Open it in Watcher first.")
        }
        Some(r) if r.status == 202u16 => {
            Err("Watcher is still scanning this address. Try again when its report is ready.")
        }
        Some(_) => Err("Watcher did not return a usable saved report."),
        None => Err("The Watcher read did not finish within the agreed response and time limits."),
    };
    REGISTRY.with_borrow_mut(|r| r.finish(owner, id, outcome, &config))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    const ADDRESS: &str = "0x0123456789abcdef0123456789abcdef01234567";
    fn person(n: u8) -> Principal {
        Principal::self_authenticating([n])
    }
    fn config() -> SpawnConfig {
        SpawnConfig {
            name: "My agent".into(),
            personality: "analyst".into(),
            addresses: vec![ADDRESS.into()],
            tools: vec!["checks".into(), "deployer".into(), "coverage".into()],
            daily_cap: 0,
        }
    }
    fn fixture() -> Value {
        json!({"entry":{"network":"mainnet","address":ADDRESS,"scannedAt":1_800_000_000_000u64,"report":{"network":"mainnet","address":ADDRESS,"block":19,"blockHash":"0x".to_owned()+&"aa".repeat(32),"rules":RULES.iter().map(|(k,_)|json!({"key":k,"status":if *k=="mint" {"Reproduced"} else {"Untested"}})).collect::<Vec<_>>()},
            "details":{"intel":{"origin":{"wallet":ADDRESS,"history":{"items":[{"kind":"Wallet creation"},{"kind":"Factory creation · wallet unknown"}],"direct":12,"internal":null}}}}}})
    }
    fn read_fixture(v: &Value) -> Option<Source> {
        project(&serde_json::to_vec(v).unwrap(), ADDRESS)
    }
    #[test]
    fn owner_limits_and_validation() {
        let mut r = Registry::default();
        let p = person(1);
        assert!(r.save(Principal::anonymous(), config(), 1).is_err());
        assert!(r
            .save(Principal::management_canister(), config(), 1)
            .is_err());
        for other in [
            SpawnConfig {
                tools: vec!["transfer".into()],
                ..config()
            },
            SpawnConfig {
                addresses: vec![format!("{ADDRESS}?evil=1")],
                ..config()
            },
            SpawnConfig {
                daily_cap: 1_000_001,
                ..config()
            },
            SpawnConfig {
                addresses: vec![ADDRESS.into(), ADDRESS.into()],
                ..config()
            },
            SpawnConfig {
                personality: "root".into(),
                ..config()
            },
        ] {
            assert!(r.save(p, other, 1).is_err());
        }
        assert!(r.save(p, config(), 1).is_ok());
        assert!(r.save(p, config(), 2).is_err());
        assert!(r.begin(person(2), ADDRESS, 1).is_err());
        assert!(r.begin(p, PLATFORM, 1).is_err());
        let (c, id) = r.begin(p, ADDRESS, 2).unwrap();
        assert!(r.begin(p, ADDRESS, 3).is_err());
        assert!(r.save(p, config(), MINUTE + 2).is_err());
        let a = r
            .finish(p, id, Ok(read_fixture(&fixture()).unwrap()), &c)
            .unwrap();
        assert_eq!(a.source_block, Some(19));
        assert_eq!(a.fee, 0);
        assert_eq!(a.status, "complete");
        assert!(r.begin(p, ADDRESS, MINUTE).is_err());
        assert!(r.begin(p, ADDRESS, MINUTE + 2).is_ok());
    }
    #[test]
    fn bounded_rolling_limits_and_no_permanent_inflight_lock() {
        let mut r = Registry::default();
        for i in 0..8 {
            r.save(person(i), config(), 1).unwrap();
        }
        assert!(r.save(person(8), config(), 2).is_err());
        assert!(r.save(person(8), config(), 1 + HOUR).is_ok());
        let (_, old) = r.begin(person(0), ADDRESS, HOUR + 2).unwrap();
        r.begin(person(1), ADDRESS, HOUR + 2).unwrap();
        assert!(r.begin(person(2), ADDRESS, HOUR + 3).is_err());
        let (c, new) = r.begin(person(0), ADDRESS, HOUR + 2 + LEASE).unwrap();
        assert_ne!(new, old);
        assert!(r.finish(person(0), old, Err("late"), &c).is_err());
        r.finish(person(0), new, Err("no report"), &c).unwrap();
        let (c, id) = r.begin(person(2), ADDRESS, HOUR + 3 + LEASE).unwrap();
        let mut restored: Registry = candid::decode_one(&candid::encode_one(&r).unwrap()).unwrap();
        restored.recover(0, true);
        assert_eq!(
            restored.projects[&person(2)].activity[0].status,
            "unavailable"
        );
        assert!(restored
            .finish(person(2), id, Err("old callback"), &c)
            .is_err());
        assert_eq!(restored.starts, r.starts);
        assert_eq!(restored.creates, r.creates);
        assert!(restored
            .begin(person(2), ADDRESS, HOUR + 4 + LEASE)
            .is_err());
        for i in 0..8 {
            let t = 2 * HOUR + i * MINUTE;
            let (c, id) = restored.begin(person(2), ADDRESS, t).unwrap();
            restored
                .finish(person(2), id, Err("unavailable"), &c)
                .unwrap();
        }
        assert_eq!(restored.projects[&person(2)].activity.len(), MAX_ACTIVITY);
    }
    #[test]
    fn global_and_storage_caps() {
        let mut r = Registry::default();
        r.save(person(1), config(), 1).unwrap();
        for hour in 0..4 {
            for minute in 0..12 {
                let now = 1 + hour * HOUR + minute * MINUTE;
                if hour == 3 && minute >= 4 {
                    assert!(r.begin(person(1), ADDRESS, now).is_err());
                    continue;
                }
                let (c, id) = r.begin(person(1), ADDRESS, now).unwrap();
                r.finish(person(1), id, Err("no report"), &c).unwrap();
            }
            assert!(r
                .begin(person(1), ADDRESS, 1 + hour * HOUR + 13 * MINUTE)
                .is_err());
        }
        assert!(r.begin(person(1), ADDRESS, DAY + 1).is_ok());
        let mut full = Registry::default();
        for i in 0..MAX_PROJECTS {
            let owner = person(i as u8);
            full.projects.insert(
                owner,
                SpawnProject {
                    owner,
                    config: config(),
                    created_at: 1,
                    updated_at: 1,
                    activity: vec![],
                },
            );
        }
        assert!(full
            .save(Principal::self_authenticating([1, 2]), config(), 1)
            .is_err());
    }
    #[test]
    fn bound_data_to_address_network_block_and_approved_tools() {
        let mut v = fixture();
        let s = read_fixture(&v).unwrap();
        assert_eq!(s.prior, Some(1));
        assert_eq!(s.rules.as_ref().unwrap().len(), 6);
        let lines = s.lines(&SpawnConfig {
            tools: vec!["coverage".into()],
            ..config()
        });
        assert_eq!(
            lines,
            vec!["1 of 6 behavior checks ran at the saved block. 5 remained untested."]
        );
        v["entry"]["report"]["rules"][1]["key"] = json!("mint");
        assert!(read_fixture(&v).unwrap().rules.is_none());
        v["entry"]["details"]["intel"] = Value::Null;
        assert!(read_fixture(&v).unwrap().sender.is_none());
        v["entry"]["report"]["network"] = json!("testnet");
        assert!(read_fixture(&v).is_none());
        v["entry"]["report"] = Value::Null;
        assert!(read_fixture(&v).is_none());
        v["entry"]["address"] = json!(PLATFORM);
        assert_eq!(
            project(&serde_json::to_vec(&v).unwrap(), PLATFORM)
                .unwrap()
                .lines(&config()),
            vec!["GH0ST Watch: We own and trust this token."]
        );
        let mut v = fixture();
        v["entry"]["report"]["address"] = json!(PLATFORM);
        assert!(read_fixture(&v).is_none());
    }
    #[test]
    fn replica_responses_reduce_to_one_fixed_projection() {
        let raw = fixture();
        let transform = |value: &Value, date: &str, code: u16| {
            canonical_response(TransformArgs {
                context: ADDRESS.as_bytes().to_vec(),
                response: HttpRequestResult {
                    status: code.into(),
                    headers: vec![ic_management_canister_types::HttpHeader {
                        name: "Date".into(),
                        value: date.into(),
                    }],
                    body: serde_json::to_vec(value).unwrap(),
                },
            })
        };
        let a = transform(&raw, "a", 200);
        let mut other = raw.clone();
        other["entry"]["trace"] = json!(["extra"]);
        other["entry"]["details"]["market"] = json!({"x":123});
        let b = transform(&other, "b", 200);
        assert_eq!(a, b);
        assert!(a.headers.is_empty());
        assert!(a.body.len() < 300);
        assert!(transform(&raw, "date", 404).body.is_empty());
        let req = request(ADDRESS, person(1));
        assert_eq!(req.url, format!("{ORIGIN}{ADDRESS}"));
        assert_eq!(req.method, HttpMethod::GET);
        assert!(req.body.is_none());
        assert_eq!(req.max_response_bytes, Some(65_536));
    }
}
