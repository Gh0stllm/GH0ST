#!/usr/bin/env python3
"""Stage the fee-control replay fixture from the pinned private A14 fixture."""

import argparse
import hashlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = HERE.parents[1] / "activation" / "gl3_a14_ownerless_boundary_test.go"
BASE_SHA256 = "cf89f2a716ced7fbcbf5eb8c2e71709076dae36acb3206a10d13a4f9f37c6ebc"

FEE_TESTS = r"""
	feeMarker := append([]byte{3}, bytes.Repeat([]byte{0, 0, 0, 0, 0, 0, 0, 1, 3}, 8)...)
	feeTip, err := client.BlockNumber(ctx)
	Require(t, err)
	foreignFeeOpts := builder.L1Info.GetDefaultTransactOpts("User", ctx)
	foreignFeeTx, err := inbox.SendL2Message(&foreignFeeOpts, feeMarker)
	Require(t, err)
	foreignFeeReceipt, err := EnsureTxSucceeded(ctx, builder.L1.Client, foreignFeeTx)
	Require(t, err)
	foreignFeeMessage := readMessage(foreignFeeReceipt, feeMarker)
	foreignFeeBlock := waitChild(feeTip, foreignFeeMessage.MessageIndex.Uint64())
	if foreignFeeMessage.Sender == expectedAlias || arbOS(foreignFeeBlock) != params.ArbosVersion_GL3A14 {
		t.Fatal("an unrelated parent caller triggered the fee-control transition")
	}

	feeTip, err = client.BlockNumber(ctx)
	Require(t, err)
	feeActivationData, err := inboxABI.Pack("sendL2Message", feeMarker)
	Require(t, err)
	feeActivationForward := append(common.LeftPadBytes(inboxAddress.Bytes(), 32), feeActivationData...)
	feeActivationTx := builder.L1Info.PrepareTxTo("User", &executor, 1_000_000, new(big.Int), feeActivationForward)
	Require(t, builder.L1.Client.SendTransaction(ctx, feeActivationTx))
	feeActivationReceipt, err := EnsureTxSucceeded(ctx, builder.L1.Client, feeActivationTx)
	Require(t, err)
	feeActivationMessage := readMessage(feeActivationReceipt, feeMarker)
	if feeActivationMessage.Sender != expectedAlias {
		t.Fatal("invalid fee-activation sender alias")
	}
	feeAfter := waitChild(feeTip, feeActivationMessage.MessageIndex.Uint64())
	feeBefore := new(big.Int).Sub(feeAfter, big.NewInt(1))
	if arbOS(feeBefore) != params.ArbosVersion_GL3A14 || arbOS(feeAfter) != params.ArbosVersion_GL3PostingFees {
		t.Fatal("the fee-control activation did not take effect on the exact delayed block")
	}
	feeAddress := params.GL3PostingFeesAddress()
	feeABI, err := abi.JSON(strings.NewReader(precompiles.GL3PostingFeesABI))
	Require(t, err)
	feeView, err := feeABI.Pack("postingPrice")
	Require(t, err)
	readPrice := func(height *big.Int) *big.Int {
		t.Helper()
		b, err := client.CallContract(ctx, ethereum.CallMsg{To: &feeAddress, Data: feeView, Gas: 1_000_000}, height)
		Require(t, err)
		values, err := feeABI.Unpack("postingPrice", b)
		Require(t, err)
		return values[0].(*big.Int)
	}
	feeCodeBefore, err := client.CodeAt(ctx, feeAddress, feeBefore)
	Require(t, err)
	feeCodeAfter, err := client.CodeAt(ctx, feeAddress, feeAfter)
	Require(t, err)
	feeViewBefore, err := client.CallContract(ctx, ethereum.CallMsg{To: &feeAddress, Data: feeView, Gas: 1_000_000}, feeBefore)
	Require(t, err)
	if len(feeCodeBefore) != 0 || len(feeViewBefore) != 0 || !bytes.Equal(feeCodeAfter, []byte{byte(vm.INVALID)}) {
		t.Fatal("fee precompile dispatch or code changed outside the new version boundary")
	}
	a14CodeAfterFees, a14StatusAfterFees := probe(feeAfter)
	if !bytes.Equal(a14CodeAfterFees, afterCode) || !bytes.Equal(a14StatusAfterFees, afterStatus) ||
		readInstaller(feeAfter) != installer {
		t.Fatal("fee activation changed existing A14 code, engine status, or installer")
	}
	assertOwners(feeAfter)

	initialPrice := readPrice(feeAfter)
	replacement := new(big.Int).Div(initialPrice, big.NewInt(2))
	if replacement.Sign() == 0 {
		replacement.SetInt64(2)
	}
	priceUpdate, err := feeABI.Pack("setPostingPrice", initialPrice, replacement)
	Require(t, err)
	feeParent, feeChild, feeIndex := sendDelayedCall(feeAddress, priceUpdate, types.ReceiptStatusSuccessful)
	if readPrice(feeChild.BlockNumber).Cmp(replacement) != 0 {
		t.Fatal("the authorized posting price did not persist at the exact block")
	}
	priceEvent := feeABI.Events["PostingPriceSet"]
	priceEvents := 0
	for _, log := range feeChild.Logs {
		if log.Address != feeAddress || len(log.Topics) != 1 || log.Topics[0] != priceEvent.ID {
			continue
		}
		values, err := priceEvent.Inputs.Unpack(log.Data)
		Require(t, err)
		if len(values) != 2 || values[0].(*big.Int).Cmp(initialPrice) != 0 || values[1].(*big.Int).Cmp(replacement) != 0 {
			t.Fatal("posting price event does not match the approved old and new price")
		}
		priceEvents++
	}
	if priceEvents != 1 {
		t.Fatal("expected one event for the authorized fee change")
	}
	staleUpdate, err := feeABI.Pack("setPostingPrice", initialPrice, new(big.Int).Add(replacement, big.NewInt(1)))
	Require(t, err)
	_, staleFee, _ := sendDelayedCall(feeAddress, staleUpdate, types.ReceiptStatusFailed)
	if readPrice(staleFee.BlockNumber).Cmp(replacement) != 0 {
		t.Fatal("a stale expected price changed the live price")
	}
	zeroUpdate, err := feeABI.Pack("setPostingPrice", replacement, new(big.Int))
	Require(t, err)
	_, zeroFee, _ := sendDelayedCall(feeAddress, zeroUpdate, types.ReceiptStatusFailed)
	if readPrice(zeroFee.BlockNumber).Cmp(replacement) != 0 {
		t.Fatal("a zero replacement changed the live price")
	}
	signedUpdate, err := feeABI.Pack("setPostingPrice", replacement, new(big.Int).Add(replacement, big.NewInt(1)))
	Require(t, err)
	ordinaryFeeTx := builder.L2Info.PrepareTxTo("Owner", &feeAddress, 1_000_000, new(big.Int), signedUpdate)
	Require(t, client.SendTransaction(ctx, ordinaryFeeTx))
	ordinaryFeeReceipt, err := bind.WaitMined(ctx, client, ordinaryFeeTx)
	Require(t, err)
	if ordinaryFeeReceipt.Status != types.ReceiptStatusFailed {
		t.Fatal("an ordinary signed GL3 transaction changed the posting price")
	}
	assertOwners(ordinaryFeeReceipt.BlockNumber)
	feePreReplay := record("fee-before", feeBefore, nil)
	feeActivationReplay := record("fee-activation", feeAfter, feeActivationMessage.MessageIndex)
	feeUpdateReplay := record("fee-update", feeChild.BlockNumber, feeIndex)
	if feePreReplay["blockHash"] != feeActivationReplay["parentHash"] {
		t.Fatal("the fee activation replay blocks are not consecutive")
	}

"""


def replace_once(source, before, after):
    if source.count(before) != 1:
        raise ValueError(f"Unexpected private fixture anchor: {before[:70]!r}")
    return source.replace(before, after, 1)


def build_fixture(base):
    data = base.read_bytes()
    if hashlib.sha256(data).hexdigest() != BASE_SHA256:
        raise ValueError("The private A14 fixture differs from its reviewed source")
    source = data.decode("utf-8")
    source = replace_once(source, "TestGL3A14OwnerlessBoundary(", "TestGL3FeeControlBoundary(")
    if source.count("installPrivateA14Executor(") != 2:
        raise ValueError("Unexpected private parent fixture helper")
    source = source.replace("installPrivateA14Executor(", "installPrivateFeeControlExecutor(")
    source = replace_once(source, "GL3_A14_OWNERLESS_BOUNDARY_OUT", "GL3_FEE_CONTROL_BOUNDARY_OUT")
    source = replace_once(source, "GL3_A14_OWNERLESS_WASM_ROOT", "GL3_FEE_CONTROL_WASM_ROOT")
    source = replace_once(source, "context.Background(), 4*time.Minute", "context.Background(), 8*time.Minute")
    start = source.index("\tsetInstaller := func(")
    end = source.index('\tinstaller := builder.L2Info.GetAddress("Owner")', start)
    old = source[start:end]
    common = replace_once(
        old,
        "setInstaller := func(installer common.Address, wantStatus uint64)",
        "sendDelayedCall := func(address common.Address, childData []byte, wantStatus uint64)",
    )
    common = replace_once(common, '\t\tchildData, err := contract.Pack("setSeedInstaller", installer)\n\t\tRequire(t, err)\n', "")
    installer = r'''	setInstaller := func(installer common.Address, wantStatus uint64) (*types.Receipt, *types.Receipt, *big.Int) {
		t.Helper()
		data, err := contract.Pack("setSeedInstaller", installer)
		Require(t, err)
		return sendDelayedCall(address, data, wantStatus)
	}
'''
    source = source[:start] + common + installer + source[end:]
    report = "\treport := map[string]any{"
    source = replace_once(source, report, FEE_TESTS + report)
    source = replace_once(source, '"isolated parent-authorized A14 activation with a zero child owner"', '"isolated parent-authorized A14 and fee-control activation with a zero child owner"')
    source = replace_once(source, '\t\t"seedMigrationExecuted": false', r'''		"feePreActivation": feePreReplay, "feeActivation": feeActivationReplay, "feeUpdate": feeUpdateReplay,
		"feeActivationParentTransaction": feeActivationReceipt.TxHash, "feeUpdateParentTransaction": feeParent.TxHash,
		"foreignFeeActivationRejected": true, "signedFeeChangeRejected": true, "staleFeeRejected": true, "zeroFeeRejected": true,
		"feeOldPrice": initialPrice.String(), "feeNewPrice": replacement.String(), "feePriceEventVerified": true,
		"seedMigrationExecuted": false''')
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("nitro_tree", type=Path)
    parser.add_argument("--base", type=Path, default=BASE)
    args = parser.parse_args()
    try:
        root = args.nitro_tree.resolve(strict=True)
        dest = root / "system_tests" / "gl3_fee_control_boundary_test.go"
        if dest.resolve() != dest or not dest.parent.is_dir():
            raise ValueError("The private fixture destination must be inside the candidate Nitro tree")
        source = build_fixture(args.base)
        if dest.exists() and dest.read_text(encoding="utf-8") == source:
            return
        with dest.open("x", encoding="utf-8") as output:
            output.write(source)
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
