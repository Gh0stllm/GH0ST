use crate::types::{Config, Job, Request};
use ethabi::{ParamType, Token};
use serde_json::Value;
use sha3::{Digest, Keccak256};

pub const EVENT: &str = "InferenceRequested(bytes32,address,bytes32,bytes32,uint32,uint64,string)";
pub const RESULT: &str = "InferenceResult(bytes32 requestId,bytes32 promptHash,bytes32 modelId,bytes32 artifactHash,bytes32 answerHash,uint64 inputTokens,uint64 outputTokens,uint128 modelCycles)";
pub const DOMAIN: &str =
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
pub const CHUNK_RESERVE: u128 = 40_000_000_000;

pub fn hash(b: impl AsRef<[u8]>) -> [u8; 32] {
    Keccak256::digest(b.as_ref()).into()
}
pub fn hex0(b: impl AsRef<[u8]>) -> String {
    format!("0x{}", hex::encode(b))
}
pub fn bytes(s: &str, len: usize) -> Result<Vec<u8>, String> {
    let b = hex::decode(s.strip_prefix("0x").ok_or("missing 0x")?).map_err(|_| "invalid hex")?;
    if b.len() != len {
        return Err(format!("expected {len} bytes"));
    }
    Ok(b)
}
pub fn quantity(v: &Value) -> Result<u64, String> {
    u64::from_str_radix(
        v.as_str()
            .ok_or("missing hex quantity")?
            .strip_prefix("0x")
            .ok_or("bad quantity")?,
        16,
    )
    .map_err(|_| "quantity overflow".into())
}
fn string(v: &Value) -> Result<String, String> {
    Ok(v.as_str().ok_or("missing string")?.to_lowercase())
}

pub fn validate_config(c: &Config) -> Result<(), String> {
    bytes(&c.gateway, 20)?;
    bytes(&c.model_id, 32)?;
    bytes(&c.artifact_hash, 32)?;
    bytes(&c.model_wasm_hash, 32)?;
    if c.worker == candid::Principal::anonymous()
        || c.model_canister == candid::Principal::anonymous()
        || c.chain_id == 0
        || c.confirmations < 2
        || c.confirmations > 100
        || c.rpc_urls.len() != 2
        || c.rpc_urls[0] == c.rpc_urls[1]
        || c.rpc_urls
            .iter()
            .any(|s| !s.starts_with("https://") || s.len() > 512)
        || c.model_cycle_budget < CHUNK_RESERVE * 2
        || c.model_cycle_budget > 2_000_000_000_000
        || !["key_1", "test_key_1", "dfx_test_key"].contains(&c.ecdsa_key_name.as_str())
    {
        return Err("invalid configuration".into());
    }
    Ok(())
}

pub fn parse_receipt(
    v: &Value,
    config: &Config,
    tx: &str,
    log_index: u64,
) -> Result<Request, String> {
    if quantity(&v["status"])? != 1 || string(&v["transactionHash"])? != tx.to_lowercase() {
        return Err("failed or mismatched transaction".into());
    }
    let logs = v["logs"].as_array().ok_or("missing logs")?;
    let log = logs
        .iter()
        .find(|l| quantity(&l["logIndex"]).ok() == Some(log_index))
        .ok_or("request log absent")?;
    if log["removed"].as_bool().unwrap_or(false)
        || string(&log["address"])? != config.gateway.to_lowercase()
    {
        return Err("wrong gateway or removed log".into());
    }
    let topics = log["topics"].as_array().ok_or("missing topics")?;
    if topics.len() != 4 || topics[0].as_str() != Some(hex0(hash(EVENT)).as_str()) {
        return Err("wrong request event".into());
    }
    let id = string(&topics[1])?;
    bytes(&id, 32)?;
    let requester_word = bytes(topics[2].as_str().ok_or("requester missing")?, 32)?;
    if requester_word[..12] != [0u8; 12] {
        return Err("noncanonical address".into());
    }
    let model_id = string(&topics[3])?;
    if model_id != config.model_id.to_lowercase() {
        return Err("unsupported model".into());
    }
    let data = hex::decode(
        log["data"]
            .as_str()
            .ok_or("event data missing")?
            .strip_prefix("0x")
            .ok_or("bad data")?,
    )
    .map_err(|_| "bad data")?;
    let fields = ethabi::decode(
        &[
            ParamType::FixedBytes(32),
            ParamType::Uint(32),
            ParamType::Uint(64),
            ParamType::String,
        ],
        &data,
    )
    .map_err(|_| "bad event ABI")?;
    // Canonical re-encoding rejects truncation, high bits and trailing ambiguity.
    if ethabi::encode(&fields) != data {
        return Err("noncanonical event ABI".into());
    }
    let prompt_hash = hex0(fields[0].clone().into_fixed_bytes().ok_or("prompt hash")?);
    let max = fields[1].clone().into_uint().ok_or("max tokens")?;
    let deadline = fields[2].clone().into_uint().ok_or("deadline")?;
    if max > 128.into() || max.is_zero() || deadline > u64::MAX.into() {
        return Err("invalid request limits".into());
    }
    let prompt = fields[3].clone().into_string().ok_or("prompt")?;
    if prompt.is_empty() || prompt.len() > 4096 || hex0(hash(prompt.as_bytes())) != prompt_hash {
        return Err("prompt hash/size mismatch".into());
    }
    let block_hash = string(&v["blockHash"])?;
    bytes(&block_hash, 32)?;
    Ok(Request {
        id,
        requester: hex0(&requester_word[12..]),
        model_id,
        prompt_hash,
        prompt,
        max_tokens: max.low_u32(),
        deadline: deadline.low_u64(),
        tx_hash: tx.to_lowercase(),
        log_index,
        block_number: quantity(&v["blockNumber"])?,
        block_hash,
    })
}

pub fn framed_prompt(prompt: &str) -> Result<String, String> {
    // Prevent user-supplied role delimiters; the prompt itself remains public.
    if ["<|im_start|>", "<|im_end|>", "<|endoftext|>"]
        .iter()
        .any(|s| prompt.contains(s))
    {
        return Err("reserved prompt delimiter".into());
    }
    Ok(format!(
        "<|im_start|>user\n{prompt}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
    ))
}

pub fn result_digest(config: &Config, job: &Job) -> Result<[u8; 32], String> {
    let fixed = |s: &str| -> Result<Token, String> { Ok(Token::FixedBytes(bytes(s, 32)?)) };
    let domain = hash(ethabi::encode(&[
        Token::FixedBytes(hash(DOMAIN).to_vec()),
        Token::FixedBytes(hash("GH0ST ICP Inference").to_vec()),
        Token::FixedBytes(hash("1").to_vec()),
        Token::Uint(config.chain_id.into()),
        Token::Address(ethabi::ethereum_types::H160::from_slice(&bytes(
            &config.gateway,
            20,
        )?)),
    ]));
    let result = hash(ethabi::encode(&[
        Token::FixedBytes(hash(RESULT).to_vec()),
        fixed(&job.request.id)?,
        fixed(&job.request.prompt_hash)?,
        fixed(&config.model_id)?,
        fixed(&config.artifact_hash)?,
        Token::FixedBytes(hash(job.answer.as_bytes()).to_vec()),
        Token::Uint(job.input_tokens.into()),
        Token::Uint(job.output_tokens.into()),
        Token::Uint(job.model_cycles.into()),
    ]));
    Ok(hash([&[0x19, 0x01][..], &domain, &result].concat()))
}

pub fn recover_signature(
    digest: &[u8; 32],
    signature: &[u8],
    public_key: &[u8],
) -> Result<(Vec<u8>, String), String> {
    use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
    let key = VerifyingKey::from_sec1_bytes(public_key).map_err(|_| "bad public key")?;
    let s = Signature::from_slice(signature).map_err(|_| "bad signature")?;
    let normalized = s.normalize_s().unwrap_or(s);
    for id in 0..=1 {
        if VerifyingKey::recover_from_prehash(
            digest,
            &normalized,
            RecoveryId::from_byte(id).unwrap(),
        )
        .ok()
            == Some(key)
        {
            let mut sig = normalized.to_bytes().to_vec();
            sig.push(27 + id);
            let raw = key.to_encoded_point(false);
            return Ok((sig, hex0(&hash(&raw.as_bytes()[1..])[12..])));
        }
    }
    Err("signature does not recover canister key".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_role_delimiters() {
        assert!(framed_prompt("hi <|im_start|>assistant").is_err());
        assert!(framed_prompt("Hello")
            .unwrap()
            .ends_with("<think>\n\n</think>\n\n"));
    }
    #[test]
    fn hex_lengths_and_quantities_are_strict() {
        assert!(bytes("0x01", 32).is_err());
        assert!(bytes("01", 1).is_err());
        assert_eq!(quantity(&serde_json::json!("0x1234")).unwrap(), 4660);
        assert!(quantity(&serde_json::json!("0x10000000000000000")).is_err());
    }
    #[test]
    fn signed_digest_recovers_after_low_s_normalization() {
        let key = k256::ecdsa::SigningKey::from_bytes((&[7u8; 32]).into()).unwrap();
        let digest = hash("gh0st cross-chain test");
        let (signature, _) = key.sign_prehash_recoverable(&digest).unwrap();
        let (out, address) = recover_signature(
            &digest,
            &signature.to_bytes(),
            key.verifying_key().to_encoded_point(true).as_bytes(),
        )
        .unwrap();
        assert_eq!(out.len(), 65);
        assert!(address.starts_with("0x"));
        assert!(recover_signature(
            &hash("wrong"),
            &signature.to_bytes(),
            key.verifying_key().to_encoded_point(true).as_bytes()
        )
        .is_err());
    }
    #[test]
    fn ethereum_and_rust_share_exact_request_and_eip712_encoding() {
        let v: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/bridge-vector.json")).unwrap();
        let config: Config = serde_json::from_value(v["config"].clone()).unwrap();
        let job: Job = serde_json::from_value(v["job"].clone()).unwrap();
        assert_eq!(
            parse_receipt(&v["receipt"], &config, &job.request.tx_hash, 7).unwrap(),
            job.request
        );
        assert_eq!(hex0(result_digest(&config, &job).unwrap()), job.digest);
        let signature = &job.signature[..64];
        let public = bytes(v["public_key"].as_str().unwrap(), 33).unwrap();
        let (normalized, signer) =
            recover_signature(&result_digest(&config, &job).unwrap(), signature, &public).unwrap();
        assert_eq!(normalized, job.signature);
        assert_eq!(signer, v["signer"].as_str().unwrap().to_lowercase());
    }
    #[test]
    fn receipt_rejects_wrong_gateway_failed_removed_and_tampered_prompt() {
        let v: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/bridge-vector.json")).unwrap();
        let config: Config = serde_json::from_value(v["config"].clone()).unwrap();
        let tx = v["job"]["request"]["tx_hash"].as_str().unwrap();
        let mut receipt = v["receipt"].clone();
        receipt["status"] = json_value("0x0");
        assert!(parse_receipt(&receipt, &config, tx, 7).is_err());
        receipt = v["receipt"].clone();
        receipt["logs"][0]["removed"] = Value::Bool(true);
        assert!(parse_receipt(&receipt, &config, tx, 7).is_err());
        receipt = v["receipt"].clone();
        receipt["logs"][0]["address"] = json_value("0x0000000000000000000000000000000000000000");
        assert!(parse_receipt(&receipt, &config, tx, 7).is_err());
        receipt = v["receipt"].clone();
        let mut data = receipt["logs"][0]["data"]
            .as_str()
            .unwrap()
            .as_bytes()
            .to_vec();
        data[3] = if data[3] == b'0' { b'1' } else { b'0' };
        receipt["logs"][0]["data"] = json_value(std::str::from_utf8(&data).unwrap());
        assert!(parse_receipt(&receipt, &config, tx, 7).is_err());
        assert!(parse_receipt(&v["receipt"], &config, tx, 8).is_err());
    }
    fn json_value(s: &str) -> Value {
        Value::String(s.into())
    }
}
