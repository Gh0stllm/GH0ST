"""Inspect an already available host. Never installs software or changes networking.

Default mode has no network traffic. --probe-network performs one read-only
eth_chainId request; the RPC URL must be supplied through GH0ST_PARENT_RPC_URL.
Credentials, RPC URL paths and machine/network identifiers are never printed.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import urllib.request


def inspect(data_path, probe_network=False):
    system = platform.system()
    os_release = {}
    if Path("/etc/os-release").exists():
        for line in Path("/etc/os-release").read_text().splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                os_release[key] = value.strip('"')
    memory = None
    physical_cores = None
    if system == "Linux" and Path("/proc/cpuinfo").exists():
        cores = set()
        for section in Path("/proc/cpuinfo").read_text().split("\n\n"):
            fields = dict(line.split(":", 1) for line in section.splitlines() if ":" in line)
            fields = {key.strip(): value.strip() for key, value in fields.items()}
            if "physical id" in fields and "core id" in fields:
                cores.add((fields["physical id"], fields["core id"]))
        physical_cores = len(cores) if cores else None
    if Path("/proc/meminfo").exists():
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemTotal:"):
                memory = int(line.split()[1]) * 1024
    path = data_path.resolve()
    while not path.exists() and path != path.parent:
        path = path.parent
    free = shutil.disk_usage(path).free
    nvme_devices = []
    if system == "Linux" and shutil.which("lsblk"):
        try:
            rows = json.loads(subprocess.run(["lsblk", "-J", "-b", "-o", "NAME,TYPE,TRAN,SIZE"],
                                            capture_output=True, text=True, check=True, timeout=5).stdout)
            nvme_devices = [{"sizeBytes": int(row["size"])} for row in rows["blockdevices"]
                            if row.get("type") == "disk" and (row.get("tran") == "nvme" or row.get("name", "").startswith("nvme"))]
        except (ValueError, subprocess.SubprocessError, OSError):
            pass
    raid_seen = Path("/proc/mdstat").exists() and "active raid1" in Path("/proc/mdstat").read_text()
    rpc = {"attempted": probe_network, "chainId": None, "matchesRobinhood4663": False}
    if probe_network:
        endpoint = os.environ.get("GH0ST_PARENT_RPC_URL")
        if endpoint:
            try:
                payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []}).encode()
                req = urllib.request.Request(endpoint, data=payload, headers={"Content-Type": "application/json", "User-Agent": "GH0ST-readonly-preflight/1"})
                response = json.load(urllib.request.urlopen(req, timeout=10))
                rpc["chainId"] = int(response["result"], 16)
                rpc["matchesRobinhood4663"] = rpc["chainId"] == 4663
            except Exception as error:
                rpc["errorType"] = type(error).__name__
        else:
            rpc["errorType"] = "MissingRPCEnvironmentVariable"
    checks = {"linuxX86_64": system == "Linux" and platform.machine() == "x86_64",
              "ubuntu2404LTS": os_release.get("ID") == "ubuntu" and os_release.get("VERSION_ID") == "24.04",
              "atLeast8LogicalCPUs": (os.cpu_count() or 0) >= 8,
              "atLeast8VisiblePhysicalCores": physical_cores is not None and physical_cores >= 8,
              "atLeast120GiBVisibleRAM": memory is not None and memory >= 120 * 2**30,
              "atLeast850GiBCurrentlyFree": free >= 850 * 2**30,
              "atLeastTwoNVMeDisksSeen": len(nvme_devices) >= 2,
              "softwareRAID1Seen": raid_seen}
    return {"scope": "read-only host inventory, not load or engine/prover validation", "checks": checks,
            "observed": {"os": system, "architecture": platform.machine(), "logicalCPUs": os.cpu_count(), "visiblePhysicalCores": physical_cores,
                         "memoryBytes": memory, "freeBytesOnExistingAncestor": free, "nvmeDisks": nvme_devices},
            "parentRPC": rpc, "productionReady": False, "actionsChangedHost": False,
            "manualChecksRequired": ["physical core count and reserved engine CPU", "ECC capability", "actual filesystem on mirrored NVMe", "hardware RAID where mdstat is not applicable", "provider backup restore", "TLS/firewall and external exposure", "measured node plus full engine/prover load"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-path", type=Path, default=Path("/var/lib/gh0st-l3"))
    parser.add_argument("--probe-network", action="store_true")
    args = parser.parse_args()
    print(json.dumps(inspect(args.data_path, args.probe_network), indent=2))
