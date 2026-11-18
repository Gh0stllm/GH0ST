// SPDX-License-Identifier: GPL-3.0-or-later
// Narrow A14 bootstrap for GL3 after activation through the parent executor.
package precompiles

import (
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/params"
)

var a14SeedInstallerSlot = []byte("GL3_CHESS_SEED_INSTALLER_V1")

func a14DirectTransaction(c ctx, evm mech) bool {
	return evm.ChainConfig().IsGL3A14(c.State.ArbOSVersion()) &&
		!c.ReadOnly() && evm.Depth() == 0 && evm.Origin == c.caller &&
		c.txProcessor != nil && c.txProcessor.TopTxType != nil
}

func a14ParentBootstrapAuthorized(c ctx, evm mech) bool {
	alias := params.GL3A14AuthorityAlias()
	// The pinned parser constructs ContractTx only when there is an L1
	// request ID. The delayed message's authenticated poster supplies both
	// the transaction sender and the block coinbase. Sequenced unsigned
	// messages and ordinary signed transactions cannot satisfy this gate.
	return a14DirectTransaction(c, evm) && c.caller == alias &&
		evm.Context.Coinbase == alias && *c.txProcessor.TopTxType == types.ArbitrumContractTxType
}

func (p ArbGhostChessSlices) SeedInstaller(c ctx, evm mech) (addr, error) {
	var installer addr
	store := sliceStore(evm.StateDB, c, a14SeedInstallerSlot)
	size, err := store.GetBytesSize()
	if err != nil || size == 0 {
		return installer, err
	}
	if size != uint64(len(installer)) {
		return installer, errGhostChess
	}
	value, err := store.GetBytes()
	if err != nil {
		return installer, err
	}
	if len(value) != len(installer) {
		return installer, errGhostChess
	}
	copy(installer[:], value)
	return installer, nil
}

// SetSeedInstaller delegates only the method that installs the pinned seed.
// The parent executor can set this once, before the first chunk.
func (p ArbGhostChessSlices) SetSeedInstaller(c ctx, evm mech, installer addr) error {
	if !a14ParentBootstrapAuthorized(c, evm) || installer == (addr{}) ||
		installer == params.GL3A14AuthorityAlias() || evm.StateDB.GetCodeSize(installer) != 0 {
		return errGhostChess
	}
	current, err := p.SeedInstaller(c, evm)
	if err != nil {
		return err
	}
	if current != (addr{}) {
		return errGhostChess
	}
	next, _, err := p.SeedMigrationProgress(c, evm)
	if err != nil {
		return err
	}
	if next != 0 {
		return errGhostChess
	}
	return sliceStore(evm.StateDB, c, a14SeedInstallerSlot).SetBytes(installer[:])
}

func (p ArbGhostChessSlices) a14SeedInstallerAuthorized(c ctx, evm mech) (bool, error) {
	if !a14DirectTransaction(c, evm) || *c.txProcessor.TopTxType > types.DynamicFeeTxType {
		return false, nil
	}
	installer, err := p.SeedInstaller(c, evm)
	return err == nil && installer != (addr{}) && c.caller == installer, err
}

func (p ArbGhostChessSlices) setA14BootstrapCoordinator(c ctx, evm mech, coordinator addr) error {
	if !a14ParentBootstrapAuthorized(c, evm) || coordinator == (addr{}) ||
		evm.StateDB.GetCodeSize(coordinator) <= 1 {
		return errGhostChess
	}
	current, err := p.GameCoordinator(c, evm)
	if err != nil {
		return err
	}
	if current != (addr{}) {
		return errGhostChess
	}
	next, chunks, err := p.SeedMigrationProgress(c, evm)
	if err != nil {
		return err
	}
	if next != chunks {
		return errGhostChess
	}
	active, err := sliceStore(evm.StateDB, c, sliceReservation).GetBytesSize()
	if err != nil {
		return err
	}
	if active != 0 {
		return errGhostChess
	}
	return sliceStore(evm.StateDB, c, sliceGameCoordinatorSlot).SetBytes(coordinator[:])
}
