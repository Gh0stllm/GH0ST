//! Deterministic receipt projection and conservative nonce policy. No network call lives here.
use crate::{R, hex, unhex};
use gh0st_chess_hybrid_brain::rpc_consensus as quorum;
use serde_json::{Value, json};

fn fixed_hex(v: &Value, len: usize) -> R<Value> {
    let b = unhex(v.as_str().ok_or("RPC bytes are not text")?)?;
    if b.len() != len {
        return Err("RPC fixed bytes length invalid".into());
    }
    Ok(json!(hex(&b)))
}
fn quantity(v: &Value) -> R<Value> {
    Ok(json!(format!("0x{:x}", quorum::quantity(v)?)))
}
fn transaction(v: &Value) -> R<Value> {
    if v.is_null() {
        return Ok(Value::Null);
    }
    let data = unhex(v["input"].as_str().ok_or("transaction input absent")?)?;
    Ok(
        json!({"hash":fixed_hex(&v["hash"],32)?,"from":fixed_hex(&v["from"],20)?,"to":fixed_hex(&v["to"],20)?,"nonce":quantity(&v["nonce"])?,"value":quantity(&v["value"])?,"input":hex(&data)}),
    )
}
fn receipt(v: &Value) -> R<Value> {
    if v.is_null() {
        return Ok(Value::Null);
    }
    Ok(
        json!({"transactionHash":fixed_hex(&v["transactionHash"],32)?,"blockHash":fixed_hex(&v["blockHash"],32)?,"blockNumber":quantity(&v["blockNumber"])?,"from":fixed_hex(&v["from"],20)?,"to":fixed_hex(&v["to"],20)?,"status":quantity(&v["status"])?,"gasUsed":quantity(&v["gasUsed"])?,"effectiveGasPrice":quantity(&v["effectiveGasPrice"])?}),
    )
}
/// The request contains only by-hash receipt and transaction. Arrival-time metadata, extra
/// node fields, batch order and case cannot alter the replicated semantic response.
pub fn receipt_batch(v: &Value) -> R<Value> {
    if v.as_array().map(Vec::len) != Some(2) {
        return Err("receipt batch must contain exactly two results".into());
    }
    let r = receipt(quorum::result(v, 1)?)?;
    let t = transaction(quorum::result(v, 2)?)?;
    Ok(json!([{"jsonrpc":"2.0","id":1,"result":r},{"jsonrpc":"2.0","id":2,"result":t}]))
}
pub fn fresh_nonce(confirmed: u64, latest_max: u64, pending_max: u64) -> R<u64> {
    if confirmed != latest_max || confirmed != pending_max {
        return Err("relay account nonce is occupied; no fresh transaction".into());
    }
    Ok(confirmed)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn batch() -> Value {
        let h = "0x".to_owned() + &"AA".repeat(32);
        let a = "0x".to_owned() + &"BB".repeat(20);
        json!([{"jsonrpc":"2.0","id":1,"result":{"transactionHash":h,"blockHash":h,"blockNumber":"0x12","from":a,"to":a,"status":"0x1","gasUsed":"0x55","effectiveGasPrice":"0x9","volatileExtra":"foo"}},{"jsonrpc":"2.0","id":2,"result":{"hash":h,"from":a,"to":a,"nonce":"0x0","value":"0x0","input":"0xABCDEF","blockNumber":"0x12","gasPrice":"0x9"}}])
    }
    #[test]
    fn stable_semantics_ignore_batch_order_extra_fields_and_case() {
        let a = batch();
        let mut b = a.clone();
        b.as_array_mut().unwrap().reverse();
        b[0]["result"]["gasPrice"] = json!("0xabcdef");
        b[1]["result"]["volatileExtra"] = json!("bar");
        assert_eq!(receipt_batch(&a).unwrap(), receipt_batch(&b).unwrap());
        assert_eq!(
            receipt_batch(&a).unwrap()[1]["result"]["input"],
            json!("0xabcdef")
        );
    }
    #[test]
    fn pending_and_included_are_not_equivalent() {
        let a = batch();
        let mut b = a.clone();
        b[0]["result"] = Value::Null;
        assert_ne!(receipt_batch(&a).unwrap(), receipt_batch(&b).unwrap());
    }
    #[test]
    fn checked_fields_cannot_be_normalized_away() {
        let a = batch();
        for field in [
            "transactionHash",
            "blockHash",
            "blockNumber",
            "from",
            "to",
            "status",
            "gasUsed",
            "effectiveGasPrice",
        ] {
            let mut b = a.clone();
            b[0]["result"][field] = Value::Null;
            assert!(receipt_batch(&b).is_err(), "{field}");
        }
        let mut b = a.clone();
        b[1]["id"] = json!(1);
        assert!(receipt_batch(&b).is_err());
    }
    #[test]
    fn one_valid_occupied_nonce_stops_fresh_intent() {
        assert_eq!(fresh_nonce(7, 7, 7).unwrap(), 7);
        assert!(fresh_nonce(7, 7, 8).is_err());
        assert!(fresh_nonce(7, 8, 8).is_err());
        assert!(fresh_nonce(8, 7, 7).is_err());
    }
}

/// Advisory values may only request fresh confirmed verification, never start work.
pub fn advisory_suggests_work(
    active: crate::Hash,
    watched: crate::Hash,
    game: Option<&crate::Game>,
    last_relayed: crate::Hash,
    last_ply: u32,
) -> bool {
    active != watched
        || game.is_some_and(|g| {
            g.result != 0 || (g.black_to_move && (active != last_relayed || g.ply != last_ply))
        })
}
