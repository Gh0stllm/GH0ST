// SPDX-License-Identifier: GPL-3.0-or-later
package arbosState

import (
	"errors"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/params"
)

var gl3A14ParentApprovalNamespace = []byte("GL3_A14_PARENT_APPROVAL_V1")

func (state *ArbosState) gl3A14ParentApproved() (bool, error) {
	approved, err := state.backingStorage.OpenSubStorage(gl3A14ParentApprovalNamespace).GetUint64ByUint64(0)
	return approved == 1, err
}

// ScheduleGL3A14FromParent is an internal state transition, with no EVM ABI.
// The block processor authenticates the delayed inbox message before calling.
func (state *ArbosState) ScheduleGL3A14FromParent(config *params.ChainConfig, timestamp uint64) error {
	if state.ArbOSVersion() != params.ArbosVersion_61 || !config.IsGL3A14(params.ArbosVersion_GL3A14) {
		return errors.New("A14 activation requires sealed GL3 ArbOS 61")
	}
	owners, err := state.ChainOwners().AllMembers(2)
	if err != nil {
		return err
	}
	if len(owners) != 1 || owners[0] != (common.Address{}) {
		return errors.New("A14 activation requires the renounced GL3 owner list")
	}
	pending, _, err := state.GetScheduledUpgrade()
	if err != nil {
		return err
	}
	if pending > params.ArbosVersion_61 {
		return errors.New("A14 activation would replace a pending ArbOS upgrade")
	}
	if err := state.backingStorage.OpenSubStorage(gl3A14ParentApprovalNamespace).SetUint64ByUint64(0, 1); err != nil {
		return err
	}
	return state.ScheduleArbOSUpgrade(params.ArbosVersion_GL3A14, timestamp)
}
