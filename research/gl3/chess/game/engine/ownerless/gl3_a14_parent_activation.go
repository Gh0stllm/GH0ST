// SPDX-License-Identifier: GPL-3.0-or-later
package arbos

import (
	"bytes"
	"math"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/params"

	"github.com/offchainlabs/nitro/arbos/arbosState"
	"github.com/offchainlabs/nitro/arbos/arbostypes"
)

// The outer batch contains seven nested empty batches. The stock parser
// accepts these exact bytes as a valid L2 message with no user transactions.
var gl3A14ActivationMessage = common.FromHex(
	"0x03000000000000000103000000000000000103000000000000000103000000000000000103000000000000000103000000000000000103000000000000000103",
)

func scheduleGL3A14FromInbox(
	state *arbosState.ArbosState,
	config *params.ChainConfig,
	l1 *arbostypes.L1IncomingMessageHeader,
	body []byte,
	priorDelayed, delayedRead, activationTimestamp uint64,
) error {
	if state.ArbOSVersion() != params.ArbosVersion_61 || !config.IsGL3A14(params.ArbosVersion_GL3A14) ||
		l1.Kind != arbostypes.L1MessageType_L2Message || l1.Poster != params.GL3A14AuthorityAlias() ||
		priorDelayed == math.MaxUint64 || delayedRead != priorDelayed+1 || !bytes.Equal(body, gl3A14ActivationMessage) {
		return nil
	}
	index, err := l1.SeqNum()
	if err != nil || index != priorDelayed {
		return nil
	}
	return state.ScheduleGL3A14FromParent(config, activationTimestamp)
}
