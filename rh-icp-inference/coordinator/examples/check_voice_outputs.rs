//! Apply the exact canister quality gate to native completion reports on stdin.
use gh0st_icp_coordinator::persona;
use std::io::Read;
fn main() {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    let rows: Vec<serde_json::Value> = serde_json::from_str(&input).unwrap();
    let out: Vec<_> = rows
        .into_iter()
        .map(|row| {
            let text = row["text"].as_str().unwrap();
            let recent: Vec<String> = row
                .get("recent_references")
                .map(|v| serde_json::from_value(v.clone()).unwrap())
                .unwrap_or_default();
            match persona::validate_thought(text, &recent) {
                Ok(normalized) => {
                    serde_json::json!({"name":row["name"],"valid":true,"normalized":normalized})
                }
                Err(reason) => {
                    serde_json::json!({"name":row["name"],"valid":false,"reason":reason})
                }
            }
        })
        .collect();
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
