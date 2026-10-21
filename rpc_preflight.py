"""Read-only Robinhood RPC preflight. Never signs or broadcasts a transaction."""
import argparse
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def rpc(endpoint, method, params):
    request = urllib.request.Request(endpoint, data=json.dumps({"jsonrpc":"2.0","id":1,
                                     "method":method,"params":params}).encode(),
                                     headers={"Content-Type":"application/json",
                                              "User-Agent":"OnchainLFM-preflight/0.1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    if "error" in payload:
        raise RuntimeError(payload["error"])
    return payload["result"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rpc", default="https://rpc.mainnet.chain.robinhood.com")
    parser.add_argument("--expected-chain-id", type=int, default=4663)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "results" / "rpc.json")
    args = parser.parse_args()
    chain_id = int(rpc(args.rpc,"eth_chainId",[]),16)
    if chain_id != args.expected_chain_id:
        raise SystemExit(f"Unexpected chain ID {chain_id}; expected {args.expected_chain_id}")
    block = rpc(args.rpc,"eth_getBlockByNumber",["latest",False])
    report = {"checked_at":datetime.now(timezone.utc).isoformat(),"chain_id":chain_id,
              "block_number":int(block["number"],16),"block_hash":block["hash"],
              "reported_block_gas_limit":int(block["gasLimit"],16),
              "gas_price_wei":int(rpc(args.rpc,"eth_gasPrice",[]),16),
              "transactions_broadcast":0,"stylus_activation_verified":False,
              "note":"RPC reachability and block header only. Header gas limit is not an inferred Stylus transaction compute budget."}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2))


if __name__ == "__main__":
    main()
