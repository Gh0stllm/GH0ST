"""Pure, fail-closed guards for a future private lifecycle controller.

These predicates accept captured values only. They never inspect a running
fixture, contact a chain, launch a process or confer production acceptance.
"""
import re
from collections.abc import Mapping


class AcceptanceError(ValueError):
    """Required, fresh and content-bound acceptance evidence is absent."""


def require(condition, message):
    if not condition:
        raise AcceptanceError(message)


def _mapping(value, name):
    require(isinstance(value, Mapping), name + " must be an object")
    return value


def _true(value, name):
    require(value is True, name + " must be exactly true")


def _hex(value, digits, name, prefix="0x"):
    require(isinstance(value, str) and
            re.fullmatch(re.escape(prefix) + "[0-9a-fA-F]{" + str(digits) + "}", value),
            name + " must be a complete hexadecimal identity")
    return value.lower()


def _positive(value, name):
    require(type(value) is int and value > 0, name + " must be a positive integer")
    return value


def _uint64(value, name):
    require((type(value) is int and 0 <= value < 2**64) or
            (isinstance(value, str) and re.fullmatch(r"0|[1-9][0-9]*", value)
             and int(value) < 2**64), name + " must be a canonical uint64")
    return int(value)


def validate_reuse(previous, compiled_inputs, binary_sha256):
    """Only reuse a successful build with identical inputs and actual binary."""
    _mapping(previous, "build manifest")
    _mapping(compiled_inputs, "current compiled inputs")
    require(bool(compiled_inputs), "Compiled-input snapshot must not be empty")
    _true(previous.get("buildCompleted"), "buildCompleted")
    require(type(previous.get("buildExitCode")) is int and previous["buildExitCode"] == 0,
            "Previous compiler must have an actual successful exit")
    require(previous.get("compiledInputs") == compiled_inputs,
            "Compiled source/options/environment changed; rebuild explicitly")
    actual = _hex(binary_sha256, 64, "actual binary SHA256", prefix="")
    require(_hex(previous.get("binarySHA256"), 64, "manifest binary SHA256", prefix="") == actual,
            "Compiled binary changed; rebuild explicitly")


SELECTED_ROOT = "0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086"
SELECTED_MACHINE = "4bf7fe54c28ad0b6f2620df3ee6b4c6d87452f9ab76ec8be294eb7d4c934770e"
SELECTED_GUEST = "8d18145460e5f4c649895728fa089a52a04ead2c3fa5e7d10789d72d7de42fbd"
SELECTED_COMPANION = "b481f92a852a685411db42c8b51abd3a3f2c8cd8c5d0c1c8eed2962d986f5555"
SELECTED_INPUT = "bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90"
SELECTED_PROVER = "cc5c9de07b2a739978e383cd4ac4baee3a1d49761c5c75ad414e12056cd7ab27"


def validate_cache_integration_review(review, candidate_sha256):
    """Bind a private launch to the independently reviewed host candidate."""
    _mapping(review, "cache integration review")
    _true(review.get("passed"), "cache integration passed")
    require(review.get("hostCandidateManifestSHA256") ==
            _hex(candidate_sha256, 64, "host candidate manifest SHA", prefix=""),
            "Cache review does not bind the selected host candidate")
    for flag in ["independentIntegrationPassed", "boundedRealPrefixPassed",
                 "authenticMemoReusePassed", "allExecutionOnRunpod"]:
        _true(review.get(flag), "cache review " + flag)
    require(review.get("enginePolicyChanged") is False and
            review.get("moduleRoot") == SELECTED_ROOT,
            "Cache review selected machine or strength changed")


def validate_final_host_authorization(authorization, expected):
    """Reject a stale authorization after any final host composition change."""
    _mapping(authorization, "root authorization")
    _mapping(expected, "final host composition")
    _true(authorization.get("authorized"), "root authorized")
    require(authorization.get("scope") == "PRIVATE_SELECTED_865_GEOMETRY43_LIFECYCLE_ONLY",
            "Authorization is not for this private lifecycle")
    fields = {"binarySHA256", "compiledInputsSHA256", "controllerSHA256",
              "hostCandidateManifestSHA256", "cacheIntegrationReviewSHA256"}
    require(set(expected) == fields, "Incomplete final host composition")
    for field in fields:
        wanted = _hex(expected[field], 64, field, prefix="")
        require(authorization.get(field) == wanted,
                "Root authorization final composition mismatch: " + field)


def validate_launch_prerequisites(interpreter, geometry, authorization, *,
                                  interpreter_sha256, geometry_sha256, boundary=None, boundary_sha256=None):
    """Accepted original replay + explicit backend/geometry/root review, never JIT."""
    for x, name in [(boundary, "offset/cap boundary receipt"), (interpreter, "interpreter"), (geometry, "geometry"),
                    (authorization, "root authorization")]:
        _mapping(x, name)
    _true(interpreter.get("passed"), "interpreter passed")
    require(type(interpreter.get("exitCode")) is int and interpreter["exitCode"] == 0,
            "Interpreter must have its actual successful exit")
    require(interpreter.get("timedOut") is False, "Timed-out interpreter cannot launch lifecycle")
    _true(interpreter.get("machineFinished"), "interpreter Finished")
    _true(interpreter.get("allFourGlobalStateFieldsMatch"), "interpreter all-four match")
    require(interpreter.get("actualEnd") == interpreter.get("expectedEnd") and
            isinstance(interpreter.get("actualEnd"), list) and len(interpreter["actualEnd"]) == 4,
            "Interpreter end-state identities differ or are incomplete")
    require(interpreter["actualEnd"] == [
        "0x8d33a6345311761aef5c7ee9e5528350f17beda843d0563cfdd103aeec70d738",
        "0x" + "00" * 32, "2470", "0"], "Interpreter receipt is not the original selected terminal input")
    identities = {"moduleRoot": SELECTED_ROOT, "machineSHA256": SELECTED_MACHINE,
                  "guestWasmSHA256": SELECTED_GUEST, "companionSHA256": SELECTED_COMPANION,
                  "inputSHA256": SELECTED_INPUT, "proverSHA256": SELECTED_PROVER}
    for field, wanted in identities.items():
        require(interpreter.get(field) == wanted, "Interpreter " + field + " changed")
    _true(boundary.get("passed"), "actual offset/cap prerequisite")
    for field, wanted in identities.items():
        require(boundary.get(field) == wanted, "Boundary " + field + " changed")
    cap = 2**43
    expected_boundary = {"actualKickoffOffset": 1, "actualWrappedStartStep": 0,
        "actualRawStepAtWrapped1": 0, "actualRawStepAtWrapped2": 1,
        "rawMachineLimitFromPinnedSource": cap,
        "solidityForcedErrorRunningIndex": cap - 1,
        "largestRawNaturalFinishAvoidingThatForcedError": cap - 2}
    require(all(type(boundary.get(k)) is int and boundary[k] == v
                for k, v in expected_boundary.items()), "Boundary offset/protocol-cap relation changed")
    require(boundary.get("nativeBackendLibrarySHA256") == "42cc75b003aaab6686620da6ec947bb475fe221b605bd0ac1bf417a171f4546c" and
            boundary.get("wrappedFinishedIndexRelationFromPinnedWrapper") == "rawExactFinalSteps + 1",
            "Boundary selected backend or wrapped Finished relation changed")
    digest = _hex(boundary_sha256, 64, "offset/cap boundary receipt SHA", prefix="")
    require(geometry.get("offsetCapBoundaryReceiptSHA256") == digest and
            authorization.get("offsetCapBoundaryReceiptSHA256") == digest,
            "Geometry and root authorization must bind the exact offset/cap prerequisite")
    raw = _positive(interpreter.get("rawExactFinalSteps"), "actual raw final steps")
    require(_uint64(interpreter.get("rawCounterPlusOne"), "raw counter plus one") == raw + 1,
            "Interpreter counter+1 is not exact")
    for flag in ["reviewed", "finishedAbsorbingTransitionReviewed", "kickoffOffsetBindingReviewed",
                 "sameSelectedBackendWitnessesReviewed"]:
        _true(geometry.get(flag), "geometry " + flag)
    require(geometry.get("moduleRoot") == SELECTED_ROOT and
            geometry.get("machineSHA256") == SELECTED_MACHINE and
            geometry.get("interpreterResultSHA256") == _hex(interpreter_sha256, 64, "interpreter receipt SHA", prefix=""),
            "Geometry is not bound to this accepted selected replay")
    require(all(type(geometry.get(k)) is int for k in
                ["blockHeight", "numBigStepLevels", "bigStepHeight", "smallStepHeight"]) and
            geometry.get("blockHeight") == 8192 and geometry.get("numBigStepLevels") == 3 and
            geometry.get("bigStepHeight") == 2048 and geometry.get("smallStepHeight") == 1024 and
            geometry.get("levelHeights") == [8192, 2048, 2048, 2048, 1024] and
            all(type(h) is int for h in geometry.get("levelHeights", [])),
            "Reviewed geometry does not match the compiled private fixture")
    capacity = 2048**3 * 1024
    require(type(geometry.get("stepsPerBlockCapacity")) is int and
            type(geometry.get("rawExactFinalSteps")) is int and
            type(geometry.get("rawCounterPlusOne")) is int and
            geometry.get("stepsPerBlockCapacity") == capacity and
            geometry.get("rawExactFinalSteps") == raw and geometry.get("rawCounterPlusOne") == raw + 1 and
            type(geometry.get("kickoffOffset")) is int and geometry.get("kickoffOffset") == 1 and raw + 1 <= capacity and raw + 1 < cap,
            "Raw counter/kickoff offset does not fit the reviewed geometry")
    _true(authorization.get("authorized"), "explicit root authorization")
    require(authorization.get("scope") == "PRIVATE_SELECTED_865_GEOMETRY43_LIFECYCLE_ONLY" and
            authorization.get("moduleRoot") == SELECTED_ROOT and
            authorization.get("interpreterResultSHA256") == interpreter_sha256 and
            authorization.get("geometryReviewSHA256") == _hex(geometry_sha256, 64, "geometry receipt SHA", prefix=""),
            "Root authorization does not bind these exact accepted receipts")
    return {"passed": True, "moduleRoot": SELECTED_ROOT, "rawExactFinalSteps": raw,
            "rawCounterPlusOne": raw + 1, "stepsPerBlockCapacity": capacity,
            "levelHeights": [8192, 2048, 2048, 2048, 1024],
            "protocolMachineStepCap": cap, "largestAllowedRawNaturalFinish": cap - 2,
            "offsetCapBoundaryReceiptSHA256": digest,
            "scope": "Reviewed prerequisite for a future private lifecycle, not that lifecycle's acceptance"}


def validate_named_test(exit_code, log, name="TestGL3TerminalResultBoLDLifecycle"):
    """Exit zero cannot replace a unique, completed, unskipped named Go test."""
    require(type(exit_code) is int and exit_code == 0, "Named test process did not exit zero")
    require(isinstance(log, str), "Named test log is missing")
    lines = log.splitlines()
    runs = [i for i, line in enumerate(lines) if line == "=== RUN   " + name]
    passes = [i for i, line in enumerate(lines)
              if re.fullmatch(r"--- PASS: " + re.escape(name) + r" \([0-9.]+s\)", line)]
    require(len(runs) == len(passes) == 1 and passes[0] > runs[0],
            "Named test must start and complete exactly once")
    require(not any(re.match(r"\s*--- (?:FAIL|SKIP): " + re.escape(name) + r"(?:[ /]|$)", line)
                    for line in lines), "Named test/subtest failed or was skipped")
    require(not any(re.match(r"(?:FAIL|\?\s+.*\[no test files\])(?:\s|$)", line)
                    for line in lines), "Go test did not finish successfully")
    require(any(line == "PASS" for line in lines[passes[0] + 1:]),
            "Final Go PASS marker is missing")


def _order(value, name):
    require(isinstance(value, list) and len(value) == 3, name + " must have three positions")
    require(all(isinstance(x, str) and re.fullmatch(r"0|[1-9][0-9]*", x) for x in value),
            name + " must contain canonical nonnegative integers")
    return tuple(int(x) for x in value)


def _bound_path(item, honest_root, name):
    _mapping(item, name)
    edge = _hex(item.get("edge"), 64, name + " edge")
    path = item.get("path")
    require(isinstance(path, list), name + " honest-root path is missing")
    cursor = honest_root
    seen = {cursor}
    for link in path:
        _mapping(link, name + " path link")
        require(_hex(link.get("from"), 64, "path parent") == cursor,
                name + " is not descended from the exact honest root")
        require(link.get("kind") in {"bisection-lower", "bisection-upper", "subchallenge-claim"},
                name + " has an unknown path relation")
        cursor = _hex(link.get("to"), 64, "path child")
        require(cursor not in seen, name + " path contains a cycle")
        seen.add(cursor)
    require(cursor == edge, name + " path does not terminate at its claimed edge")
    _hex(item.get("transaction"), 64, name + " transaction")
    return edge, _order(item.get("order"), name + " order")


def validate_acceptance(*, test_exit, test_log, report, audit_exit, audit,
                        terminal, run_id, module_root, completion=None, audit_sha256=None):
    """Validate fresh fixture + independently audited exact target/refund bindings."""
    validate_named_test(test_exit, test_log)
    require(isinstance(run_id, str) and re.fullmatch(r"[0-9a-f]{32}", run_id),
            "A fresh UUID run identifier is required")
    module = _hex(module_root, 64, "selected module root")
    for value, name in [(report, "fixture report"), (audit, "strict audit"), (terminal, "terminal manifest")]:
        _mapping(value, name)
    for value, name in [(report, "fixture"), (audit, "audit")]:
        require(value.get("runID") == run_id, name + " belongs to another run")
        _true(value.get("passed"), name + " passed")
        require(_hex(value.get("moduleRoot"), 64, name + " module root") == module,
                name + " module root mismatch")
    for field in ["honestOneStepWinner", "assertionConfirmationPassed", "stakeSettlementPassed",
                  "fullStrengthDecisionVerified", "allExecutionOnRunpod",
                  "claimPairContentVerified", "strictAuditPassedBeforeCleanup"]:
        _true(report.get(field), "fixture " + field)
    require(report.get("enginePolicyChanged") is False and report.get("publicDeployment") is False,
            "Fixture scope/engine policy changed")
    _positive(report.get("honestLayerZeroRefunds"), "fixture honest-edge refund count")
    require(type(audit_exit) is int and audit_exit == 0, "Strict auditor did not exit zero")
    _mapping(completion, "pre-cleanup audit completion")
    _true(completion.get("completed"), "pre-cleanup audit completed")
    require(completion.get("runID") == run_id and completion.get("moduleRoot") == module and
            type(completion.get("auditExitCode")) is int and completion["auditExitCode"] == 0,
            "Auditor completion was not successful before fixture cleanup")
    digest = _hex(audit_sha256, 64, "strict audit file SHA", prefix="")
    require(completion.get("strictAuditSHA256") == digest and report.get("strictAuditSHA256") == digest,
            "Fixture and completion acknowledge different audit bytes")
    for field in ["targetBound", "refundExact", "terminalInputBytesVerified"]:
        _true(audit.get(field), "audit " + field)
    terminal_sha = _hex(terminal.get("SHA256"), 64, "terminal input SHA256", prefix="")
    require(terminal.get("runID") == run_id, "Terminal input manifest belongs to another run")
    require(_hex(audit.get("terminalInputSHA256"), 64, "audited input SHA256", prefix="") == terminal_sha,
            "Strict audit input SHA mismatch")
    require(_hex(terminal.get("moduleRoot"), 64, "terminal module root") == module,
            "Terminal manifest module mismatch")
    _positive(terminal.get("bytes"), "terminal input size")
    terminal_number = _uint64(terminal.get("blockNumber"), "manifest terminal block number")
    require(terminal_number > 0, "Terminal transition cannot precede genesis")
    transition = _mapping(audit.get("terminalTransitionBinding"), "terminal transition binding")
    _true(transition.get("verified"), "terminal transition binding verified")
    require(_uint64(transition.get("terminalBlockNumber"), "audited terminal block number") == terminal_number,
            "Transition audit checked another terminal block")
    require(_uint64(transition.get("startHeight"), "audited transition start") == terminal_number - 1 and
            _uint64(transition.get("endHeight"), "audited transition end") == terminal_number,
            "First block-to-machine claim is not the exact terminal transition")
    target = _mapping(terminal.get("expectedEndState"), "terminal end state")
    require(set(target) == {"BlockHash", "SendRoot", "Batch", "PosInBatch"},
            "Incomplete terminal global-state fields")
    for field in ["BlockHash", "SendRoot"]:
        _hex(target.get(field), 64, "terminal " + field)
    for field in ["Batch", "PosInBatch"]:
        value = target.get(field)
        require((type(value) is int and 0 <= value < 2**64) or
                (isinstance(value, str) and re.fullmatch(r"0|[1-9][0-9]*", value)
                 and int(value) < 2**64), "Terminal " + field + " is not a canonical uint64")
    require(audit.get("terminal") == target, "Strict auditor checked another target")
    require(_hex(report.get("terminalComputeBlock"), 64, "fixture terminal block") == target["BlockHash"].lower(),
            "Fixture checked another terminal block")
    forged = dict(target)
    forged["BlockHash"] = "0x" + (int(target["BlockHash"], 16) ^ 1).to_bytes(32, "big").hex()
    require(audit.get("forgedTerminal") == forged, "False claim is not the exact target mutation")
    pair = _mapping(audit.get("pair"), "audited target pair")
    _true(pair.get("actualTerminalGlobalsMatch"), "target globals match")
    _true(pair.get("sameBeforeStateAndBatch"), "target common predecessor")
    for field in ["honest", "false", "parent", "honestHistory", "falseHistory"]:
        _hex(pair.get(field), 64, "target pair " + field)
    require(pair["honest"].lower() != pair["false"].lower() and
            pair["honestHistory"].lower() != pair["falseHistory"].lower(), "Target rivals are not distinct")
    for field, key in [("targetHonestAssertion", "honest"), ("targetFalseAssertion", "false"),
                       ("targetParentAssertion", "parent"), ("expectedHonestHistory", "honestHistory"),
                       ("expectedFalseHistory", "falseHistory")]:
        require(_hex(report.get(field), 64, "fixture " + field) == pair[key].lower(),
                "Fixture content classification differs from audited pair")
    for field in ["honestSender", "manager", "rollup"]:
        _hex(pair.get(field), 40, "target pair " + field)
    roots = _mapping(audit.get("targetRootEdges"), "target root edges")
    for side in ["honest", "false"]:
        require(isinstance(roots.get(side), list) and len(roots[side]) == 1,
                "Exactly one " + side + " target root is required")
    honest_root = _hex(roots["honest"][0], 64, "honest root")
    require(honest_root != _hex(roots["false"][0], 64, "false root"), "Target root edges are identical")
    proofs = audit.get("boundOneStepEvents")
    require(isinstance(proofs, list) and bool(proofs), "Content-bound one-step proof is missing")
    proof_orders = []
    fixture_proof_bound = False
    for proof in proofs:
        edge, order = _bound_path(proof, honest_root, "one-step proof")
        require(proof.get("receiptStatus") == "0x1", "One-step receipt did not succeed")
        proof_orders.append(order)
        if (edge == str(report.get("oneStepEdge")).lower() and
                proof["transaction"].lower() == str(report.get("oneStepTransaction")).lower()):
            first = next((link for link in proof["path"] if link["kind"] == "subchallenge-claim"), None)
            require(first is not None and first["from"].lower() == str(transition.get("blockClaimEdge")).lower() and
                    first["to"].lower() == str(transition.get("machineSubchallengeRoot")).lower() and
                    edge == str(transition.get("oneStepEdge")).lower() and
                    proof["transaction"].lower() == str(transition.get("oneStepTransaction")).lower(),
                    "Fixture proof is not the transition-bound machine descendant")
            fixture_proof_bound = True
    require(fixture_proof_bound, "Fixture one-step winner is not the audited target proof")
    states = _mapping(audit.get("assertionStates"), "assertion states")
    honest_state = _mapping(states.get("honest"), "honest assertion state")
    false_state = _mapping(states.get("false"), "false assertion state")
    require(honest_state.get("status") == "2" and false_state.get("status") in {"0", "1"},
            "Exact honest target must confirm while its false rival remains unconfirmed")
    confirmations = audit.get("boundConfirmations")
    require(isinstance(confirmations, list) and bool(confirmations), "Exact assertion confirmation is missing")
    confirmation_orders = []
    for confirmation in confirmations:
        _mapping(confirmation, "assertion confirmation")
        require(_hex(confirmation.get("hash"), 64, "confirmed assertion") == pair["honest"].lower(),
                "Another assertion was confirmed")
        _hex(confirmation.get("transaction"), 64, "confirmation transaction")
        order = _order(confirmation.get("order"), "confirmation order")
        require(any(order > proof_order for proof_order in proof_orders), "Confirmation predates target proof")
        confirmation_orders.append(order)
    refunds = audit.get("boundCollateralRefunds")
    require(isinstance(refunds, list) and bool(refunds), "Exact collateral refund evidence is missing")
    layer_zero_refund = False
    for refund in refunds:
        _, order = _bound_path(refund, honest_root, "collateral refund")
        for field in ["exactTransfer", "blockBalancesReconcile"]:
            _true(refund.get(field), "refund " + field)
        _hex(refund.get("stakeToken"), 40, "refund token")
        require(_hex(refund.get("receiver"), 40, "refund recipient") == pair["honestSender"].lower(),
                "Refund recipient differs from honest claimant")
        require(isinstance(refund.get("amount"), str) and re.fullmatch(r"[1-9][0-9]*", refund["amount"]),
                "Refund collateral must be positive and exact")
        require(any(order > confirmation_order for confirmation_order in confirmation_orders),
                "Refund predates exact assertion confirmation")
        if refund.get("level") == "0":
            require(refund["edge"].lower() == str(report.get("refundEdge")).lower() == honest_root and
                    refund["transaction"].lower() == str(report.get("refundTransaction")).lower() and
                    refund["amount"] == report.get("targetRefundAmount"),
                    "Fixture refund is not the exact audited target collateral receipt")
            layer_zero_refund = True
    require(layer_zero_refund, "Fixture layer-zero collateral refund is not audited")
    return {"passed": True, "runID": run_id, "terminalInputSHA256": terminal_sha,
            "moduleRoot": module, "strictIndependentAuditRequired": True,
            "scope": "Private terminal-block lifecycle and exact edge-collateral refund only; "
                     "no assertion-stake withdrawal, whole-move interpreter or production acceptance"}
