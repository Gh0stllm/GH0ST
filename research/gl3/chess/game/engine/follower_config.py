#!/usr/bin/env python3
"""Write a loopback-only GL3 follower profile into an isolated directory."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import stat


CHAIN_INFO = "924dd83a932ea16d1fdf84b318be9af65e1f046c4ce35732849844d650bca2b9"
GENESIS = "2b199bb88d307aac0f25bffb26154ec1a02b43541f7f0d1bf551b9980983c8dc"
PARENT_RPC = "https://rpc.mainnet.chain.robinhood.com"


def verified_bytes(path, digest):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f"Unexpected receipt-derived file {path.name}")
    return data


def verified_parent_rpc(path=None):
    if path is None:
        return PARENT_RPC
    mode = path.lstat().st_mode
    if not stat.S_ISREG(mode) or stat.S_IMODE(mode) != 0o600:
        raise ValueError("The archive RPC file must be a private regular file with mode 0600")
    url = path.read_text().strip()
    if not re.fullmatch(r"https://robinhood-mainnet\.g\.alchemy\.com/v2/[A-Za-z0-9_-]+", url):
        raise ValueError("The archive RPC file must contain the Robinhood mainnet provider URL")
    return url


def follower_config(root, port, parent_rpc=PARENT_RPC):
    return {
        "log-level": "INFO",
        "chain": {"id": 4663001, "name": "GL3", "info-files": [str(root / "chain-info.json")]},
        "parent-chain": {
            "id": 4663,
            "connection": {"url": parent_rpc, "retries": 2, "retry-delay": "2s"},
        },
        "init": {"genesis-json-file": str(root / "genesis.json"), "validate-genesis-assertion": True},
        "ensure-rollup-deployment": True,
        "persistent": {
            "chain": str(root / "chain"),
            "global-config": str(root / "global-config"),
            "db-engine": "pebble",
        },
        "http": {"addr": "127.0.0.1", "port": port, "api": ["eth", "net"], "vhosts": ["127.0.0.1", "localhost"]},
        "ipc": {"path": ""},
        "ws": {"addr": ""},
        "auth": {"addr": ""},
        "file-logging": {"enable": False},
        "version-alerter": {"enable": False},
        "execution": {
            "sequencer": {"enable": False},
            "forwarding-target": "null",
            "caching": {"archive": False, "state-scheme": "hash"},
            "stylus-target": {"allow-offchain-activation": False},
        },
        "node": {
            "sequencer": False,
            "batch-poster": {"enable": False},
            "delayed-sequencer": {"enable": False},
            "block-validator": {"enable": False},
            "staker": {"enable": False},
            "seq-coordinator": {"enable": False},
            "parent-chain-reader": {"enable": True},
            "inbox-reader": {"read-mode": "safe"},
            "feed": {"output": {"enable": False}, "input": {"url": []}},
            "rpc-server": {"enable": False},
            "dangerous": {"disable-blob-reader": True},
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("receipt_directory", type=Path)
    parser.add_argument("new_follower_directory", type=Path)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--parent-rpc-file", type=Path)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Use an unoccupied nonprivileged loopback port")
    try:
        chain_info = verified_bytes(args.receipt_directory / "chain-info.json", CHAIN_INFO)
        genesis = verified_bytes(args.receipt_directory / "genesis.json", GENESIS)
        parent_rpc = verified_parent_rpc(args.parent_rpc_file)
        root = args.new_follower_directory.absolute()
        root.mkdir(mode=0o700)
        (root / "chain-info.json").write_bytes(chain_info)
        (root / "genesis.json").write_bytes(genesis)
        with (root / "follower.json").open("x", encoding="utf-8") as config:
            json.dump(follower_config(root, args.port, parent_rpc), config, indent=2)
            config.write("\n")
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
