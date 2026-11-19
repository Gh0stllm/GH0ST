// SPDX-License-Identifier: GPL-3.0-or-later
package arbos

import (
	"bytes"
	"math"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/params"
	"github.com/offchainlabs/nitro/arbos/arbostypes"
)

// One batch containing eight empty batches. A stock parser accepts the
// payload and returns no user transactions.
var gl3PostingFeesActivationMessage = common.FromHex(
	"0x03000000000000000103000000000000000103000000000000000103000000000000000103000000000000000103000000000000000103000000000000000103000000000000000103",
)

// Stored in an ArbitrumInternalTx so cold replay schedules the same upgrade.
// Arguments use the standard internal StartBlock layout.
var gl3PostingFeesStartBlockMethodID = [4]byte(crypto.Keccak256([]byte("startGL3PostingFeesBlock(uint256,uint64,uint64,uint64)"))[:4])

func shouldActivateGL3PostingFeesFromInbox(
	arbOSVersion uint64,
	config *params.ChainConfig,
	l1 *arbostypes.L1IncomingMessageHeader,
	body []byte,
	priorDelayed, delayedRead uint64,
) bool {
	if arbOSVersion != params.ArbosVersion_GL3A14 || !config.IsGL3PostingFees(params.ArbosVersion_GL3PostingFees) ||
		l1 == nil || l1.Kind != arbostypes.L1MessageType_L2Message || l1.Poster != params.GL3PostingFeesAuthorityAlias() ||
		priorDelayed == math.MaxUint64 || delayedRead != priorDelayed+1 || !bytes.Equal(body, gl3PostingFeesActivationMessage) {
		return false
	}
	index, err := l1.SeqNum()
	return err == nil && index == priorDelayed
}
