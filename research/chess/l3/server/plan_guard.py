"""Read-only release checks. This research bundle deliberately has no mainnet launcher.

Approval references are review inputs, never a substitute for the owner's actual
authorization. SHA checks establish bytes, not correctness of an engine/prover.
"""
import argparse
import hashlib
import json
from pathlib import Path

POLICY = {
    "engine": "Stockfish 19", "engineCommit": "edb0d9db6731067ec50ce619ff372b463bc4dd5d",
    "nnueSHA256": "1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2",
    "nnueBytes": 98511183, "nodes": 24000000, "hashMiB": 128,
    "threads": 1, "skillLevel": 20, "limitStrength": False, "multiPV": 1,
    "explicitNewGameReset": True,
    "retainedState": "complete per-game TT and histories",
}


def artifact_error(record, root, name):
    if not isinstance(record, dict) or not record.get("path") or not record.get("sha256"):
        return f"missing {name} path and SHA256"
    path = Path(record["path"])
    if not path.is_absolute():
        path = root / path
    if not path.is_file():
        return f"missing {name} file"
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    if h.hexdigest() != record["sha256"]:
        return f"{name} SHA256 mismatch"
    return None


def validate(plan, root=Path("."), mode="rehearsal"):
    errors = []
    if plan.get("parentChainId") != 4663:
        errors.append("parent must be Robinhood mainnet chain4663")
    if plan.get("nativeGasTokenOnParent", "").lower() != "0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559":
        errors.append("wrong parent GH0ST token")
    if plan.get("enginePolicy") != POLICY:
        errors.append("reviewed full-strength engine policy changed or incomplete")
    operator = plan.get("operator", {})
    if operator.get("sameHostRolesAreIndependent") is not False:
        errors.append("co-located roles must not be described as independent")
    if operator.get("publicRPCBoundToLoopback") is not True or operator.get("publicAdminRPC") is not False or operator.get("publicMetrics") is not False:
        errors.append("RPC/admin/metrics exposure is not restricted")
    financial = plan.get("financialPolicy", {})
    if financial.get("mode") != "estimates_and_review" or financial.get("automaticTopups") is not False:
        errors.append("missing current estimate policy or automatic top-ups enabled")
    if mode == "mainnet":
        # Deliberately unconditional: checking boxes cannot enable an unimplemented
        # custom execution/fraud-proof path or turn this into a mainnet launcher.
        errors.append("mainnet start is unsupported by this research-only bundle")
        if not plan.get("hostingApproval"):
            errors.append("missing concrete hosting authorization record")
        if not plan.get("validatorBondApproval"):
            errors.append("missing separate validator bond authorization record")
        child = plan.get("childChainId")
        if not isinstance(child, int) or child <= 0 or child == 4663:
            errors.append("missing distinct reviewed child chain ID")
        for field, name in [("chainConfig", "chain config"), ("customEngineArtifact", "custom engine"), ("matchingProverArtifact", "matching prover")]:
            error = artifact_error(plan.get(field), root, name)
            if error:
                errors.append(error)
        evidence = plan.get("evidence", {})
        required = ["robinhoodDeploymentPathReviewed", "licenseReviewedAndAcceptedByAuthorizedOwner",
                    "badResultChallengeRejected", "exactConsecutiveSearchParity",
                    "twentyGameCostAndLatencyVerified", "withdrawalAndDisputeRecoveryVerified"]
        errors += [f"missing verified evidence: {key}" for key in required if evidence.get(key) is not True]
    elif plan.get("purpose") != "base-chain-rehearsal":
        errors.append("rehearsal mode accepts only the base-chain-rehearsal purpose")
    return {"mode": mode, "validForRequestedMode": not errors, "productionReady": False,
            "wouldStartServices": False, "wouldSpendFunds": False, "errors": errors}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path)
    parser.add_argument("--mode", choices=["rehearsal", "mainnet"], default="rehearsal")
    args = parser.parse_args()
    result = validate(json.loads(args.plan.read_text()), args.plan.parent, args.mode)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["validForRequestedMode"] else 2)
