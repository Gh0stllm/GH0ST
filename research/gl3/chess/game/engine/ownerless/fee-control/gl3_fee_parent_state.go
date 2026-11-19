// SPDX-License-Identifier: GPL-3.0-or-later
package arbosState

import (
	"errors"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/params"
)

var gl3PostingFeesParentApprovalNamespace = []byte("GL3_POSTING_FEES_PARENT_APPROVAL_V1")

func (state *ArbosState) gl3PostingFeesParentApproved() (bool, error) {
	approved, err := state.backingStorage.OpenSubStorage(gl3PostingFeesParentApprovalNamespace).GetUint64ByUint64(0)
	return approved == 1, err
}

// ScheduleGL3PostingFeesFromParent applies the stored internal activation
// transaction after the block processor authenticates the delayed message.
func (state *ArbosState) ScheduleGL3PostingFeesFromParent(config *params.ChainConfig, timestamp uint64) error {
	if state.ArbOSVersion() != params.ArbosVersion_GL3A14 || !config.IsGL3PostingFees(params.ArbosVersion_GL3PostingFees) {
		return errors.New("GL3 posting fee activation requires sealed GL3 ArbOS 62")
	}
	a14Approved, err := state.gl3A14ParentApproved()
	if err != nil {
		return err
	}
	if !a14Approved {
		return errors.New("GL3 posting fee activation requires the parent-authorized A14 state")
	}
	owners, err := state.ChainOwners().AllMembers(2)
	if err != nil {
		return err
	}
	if len(owners) != 1 || owners[0] != (common.Address{}) {
		return errors.New("GL3 posting fee activation requires the renounced GL3 owner list")
	}
	pending, _, err := state.GetScheduledUpgrade()
	if err != nil {
		return err
	}
	if pending > params.ArbosVersion_GL3A14 {
		return errors.New("GL3 posting fee activation would replace a pending ArbOS upgrade")
	}
	if err := state.backingStorage.OpenSubStorage(gl3PostingFeesParentApprovalNamespace).SetUint64ByUint64(0, 1); err != nil {
		return err
	}
	return state.ScheduleArbOSUpgrade(params.ArbosVersion_GL3PostingFees, timestamp)
}
