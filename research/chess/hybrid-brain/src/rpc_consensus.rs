//! Committee HTTP result validation, shared by coordinator and relay without canister exports.
//! Dynamic values need13 independent requests and at least9 valid committee responses.
use crate::R;
use candid::{CandidType, Nat};
use serde::{Deserialize, Serialize};
use serde_json::Value;
pub const COMMITTEE: u32 = 13;
pub const QUORUM: usize = 9;
pub fn ensure_reviewed_subnet(nodes: u32) -> R<()> {
    if nodes == COMMITTEE {
        Ok(())
    } else {
        Err("reviewed quorum requires a13-node execution subnet".into())
    }
}
#[derive(Clone, Debug, CandidType, Deserialize, Serialize, PartialEq, Eq)]
pub struct Replication {
    pub total_requests: u32,
    pub min_responses: u32,
    pub max_responses: u32,
}
impl Default for Replication {
    fn default() -> Self {
        Self {
            total_requests: COMMITTEE,
            min_responses: QUORUM as u32,
            max_responses: COMMITTEE,
        }
    }
}
#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct Header {
    pub name: String,
    pub value: String,
}
#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct Response {
    pub status: Nat,
    pub headers: Vec<Header>,
    pub body: Vec<u8>,
}
#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub enum Method {
    #[serde(rename = "post")]
    Post,
}
candid::define_function!(pub TransformFunction:(TransformArgs)->(Response) query);
#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct TransformContext {
    pub function: TransformFunction,
    pub context: Vec<u8>,
}
#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct TransformArgs {
    pub response: Response,
    pub context: Vec<u8>,
}
#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct FlexibleArgs {
    pub url: String,
    pub max_response_bytes: Option<u64>,
    pub method: Method,
    pub headers: Vec<Header>,
    pub body: Option<Vec<u8>>,
    pub transform: Option<TransformContext>,
    pub replication: Option<Replication>,
}
#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct FlexibleError {
    pub message: String,
}
#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub enum FlexibleResponse {
    #[serde(rename = "ok")]
    Ok(Vec<Response>),
    #[serde(rename = "err")]
    Err(FlexibleError),
}
#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub enum OutcallType {
    #[serde(rename = "flexible")]
    Flexible(Option<Replication>),
}
#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct CostParams {
    pub request_bytes: u64,
    pub http_roundtrip_time_ms: u64,
    pub raw_response_bytes: u64,
    pub transformed_response_bytes: u64,
    pub transform_instructions: u64,
    pub outcall_type: Option<OutcallType>,
}
impl CostParams {
    pub fn flexible(request_bytes: u64, response_bytes: u64) -> Self {
        Self {
            request_bytes,
            http_roundtrip_time_ms: 60_000,
            raw_response_bytes: response_bytes,
            transformed_response_bytes: response_bytes + 1024,
            transform_instructions: 0,
            outcall_type: Some(OutcallType::Flexible(Some(Replication::default()))),
        }
    }
}

pub fn quantity(v: &Value) -> R<u64> {
    let s = v.as_str().ok_or("RPC quantity is not text")?;
    let h = s.strip_prefix("0x").ok_or("RPC quantity lacks0x")?;
    if h.is_empty()
        || h.len() > 16
        || (h.len() > 1 && h.starts_with('0'))
        || !h.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("RPC quantity is not canonical uint64".into());
    }
    u64::from_str_radix(h, 16).map_err(|_| "RPC quantity overflow".into())
}
fn validate_count(responses: &[Response]) -> R<()> {
    if !(QUORUM..=COMMITTEE as usize).contains(&responses.len()) {
        Err("flexible HTTP committee response count outside9..13".into())
    } else {
        Ok(())
    }
}
fn json(response: &Response) -> R<Value> {
    if response.status != 200u16 {
        return Err("committee HTTP status not200".into());
    }
    serde_json::from_slice(&response.body).map_err(|_| "committee JSON malformed".into())
}
pub fn result(v: &Value, id: u64) -> R<&Value> {
    let row = if let Some(rows) = v.as_array() {
        let matching: Vec<_> = rows.iter().filter(|r| r["id"] == id).collect();
        if matching.len() != 1 {
            return Err("RPC response ID is missing or duplicated".into());
        }
        matching[0]
    } else {
        v
    };
    if row["id"] != id || row["jsonrpc"] != "2.0" || !row["error"].is_null() {
        return Err("RPC response identity/error invalid".into());
    }
    row.get("result").ok_or("RPC result absent".into())
}
/// At most4 faulty committee members cannot move the median outside the honest head range.
pub fn head_median(responses: &[Response]) -> R<u64> {
    validate_count(responses)?;
    let mut heads = vec![];
    for response in responses {
        if let Ok(v) = json(response) {
            if let (Ok(chain), Ok(head)) = (
                result(&v, 1).and_then(quantity),
                result(&v, 2).and_then(quantity),
            ) {
                if chain == 4663 {
                    heads.push(head)
                }
            }
        }
    }
    if heads.len() < QUORUM {
        return Err("fewerthan9 valid Robinhood head responses".into());
    }
    heads.sort_unstable();
    Ok(heads[heads.len() / 2])
}
/// A read whose value matters exactly (e.g. receipt or fixed state) needs9 identical semantic results.
pub fn exact_result_vote(responses: &[Response], id: u64) -> R<Value> {
    validate_count(responses)?;
    let mut votes: std::collections::BTreeMap<Vec<u8>, (usize, Value)> =
        std::collections::BTreeMap::new();
    for response in responses {
        if let Ok(v) = json(response) {
            if let Ok(value) = result(&v, id) {
                let key = serde_json::to_vec(value).map_err(|_| "RPC normalization failed")?;
                let vote = votes.entry(key).or_insert((0, value.clone()));
                vote.0 += 1;
                if vote.0 >= QUORUM {
                    return Ok(vote.1.clone());
                }
            }
        }
    }
    Err("no9-response semantic RPC quorum".into())
}
/// Pending-nonce conservatism: no valid observed occupied nonce may be ignored.
pub fn max_quantity(responses: &[Response], id: u64) -> R<u64> {
    validate_count(responses)?;
    let values: Vec<_> = responses
        .iter()
        .filter_map(|r| {
            json(r)
                .ok()
                .and_then(|v| result(&v, id).and_then(quantity).ok())
        })
        .collect();
    if values.len() < QUORUM {
        return Err("fewerthan9 valid RPC quantities".into());
    }
    Ok(*values.iter().max().unwrap())
}
pub fn median_quantity(responses: &[Response], id: u64) -> R<u64> {
    validate_count(responses)?;
    let mut values: Vec<_> = responses
        .iter()
        .filter_map(|r| {
            json(r)
                .ok()
                .and_then(|v| result(&v, id).and_then(quantity).ok())
        })
        .collect();
    if values.len() < QUORUM {
        return Err("fewerthan9 valid RPC quantities".into());
    }
    values.sort_unstable();
    Ok(values[values.len() / 2])
}
/// JSON-RPC batches may be returned in different array order even at the same block.
pub fn normalize_batch(mut v: Value) -> Value {
    if let Some(rows) = v.as_array_mut() {
        rows.sort_by_key(|r| r.get("id").and_then(Value::as_u64));
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn committee_security_bound_is_not_reused_on_other_subnet_sizes() {
        assert!(ensure_reviewed_subnet(13).is_ok());
        for n in [0, 1, 12, 14, 34] {
            assert!(ensure_reviewed_subnet(n).is_err());
        }
    }
    fn response(chain: u64, head: u64) -> Response {
        Response{status:200u16.into(),headers:vec![],body:serde_json::to_vec(&json!([{"jsonrpc":"2.0","id":1,"result":format!("0x{chain:x}")},{"jsonrpc":"2.0","id":2,"result":format!("0x{head:x}")}])).unwrap()}
    }
    #[test]
    fn divergent_honest_heads_and_four_outliers() {
        let mut r: Vec<_> = (100..109).map(|h| response(4663, h)).collect();
        r.extend([
            response(4663, 0),
            response(4663, 1),
            response(4663, u64::MAX - 1),
            response(4663, u64::MAX),
        ]);
        assert!((100..=108).contains(&head_median(&r).unwrap()));
    }
    #[test]
    fn minimum_quorum_median() {
        let mut r: Vec<_> = (100..105).map(|h| response(4663, h)).collect();
        r.extend([
            response(4663, 0),
            response(4663, 1),
            response(4663, u64::MAX - 1),
            response(4663, u64::MAX),
        ]);
        assert!((100..=104).contains(&head_median(&r).unwrap()));
    }
    #[test]
    fn malformed_wrong_chain_and_fewer_votes_fail() {
        assert!(head_median(&vec![response(4663, 100); 8]).is_err());
        let mut r = vec![response(4663, 100); 8];
        r.extend(vec![response(1, 100); 5]);
        assert!(head_median(&r).is_err());
        let mut r = vec![response(4663, 100); 9];
        r[0].body = b"garbage".to_vec();
        assert!(head_median(&r).is_err());
    }
    #[test]
    fn exact_semantic_quorum_and_split_reject() {
        let r = vec![response(4663, 100); 9];
        assert_eq!(exact_result_vote(&r, 2).unwrap(), json!("0x64"));
        let mut split = vec![response(4663, 100); 8];
        split.extend(vec![response(4663, 101); 5]);
        assert!(exact_result_vote(&split, 2).is_err());
    }
    #[test]
    fn duplicate_ids_cannot_vote() {
        let mut r = vec![response(4663, 100); 9];
        for x in &mut r {
            let mut v: Value = serde_json::from_slice(&x.body).unwrap();
            v.as_array_mut()
                .unwrap()
                .push(json!({"jsonrpc":"2.0","id":2,"result":"0x64"}));
            x.body = serde_json::to_vec(&v).unwrap()
        }
        assert!(head_median(&r).is_err());
    }
    #[test]
    fn canonical_quantities_and_conservative_nonce() {
        for q in ["0x", "0x00", "0x01", "123", "0x10000000000000000", "0xgg"] {
            assert!(quantity(&json!(q)).is_err())
        }
        let mut r = vec![response(4663, 7); 9];
        r.push(response(4663, 8));
        assert_eq!(max_quantity(&r, 2).unwrap(), 8);
    }
    #[test]
    fn batch_order_does_not_change_normalized_consensus() {
        let a = json!([{"id":2,"result":3},{"id":1,"result":4}]);
        let b = json!([{"id":1,"result":4},{"id":2,"result":3}]);
        assert_eq!(normalize_batch(a), normalize_batch(b));
    }
}
