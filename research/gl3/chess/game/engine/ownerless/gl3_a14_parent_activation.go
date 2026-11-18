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

// The outer batch contains seven nested empty batches. The stock parser
// accepts these exact bytes as a valid L2 message with no user transactions.
var gl3A14ActivationMessage = common.FromHex(
	"0x03000000000000000103000000000000000103000000000000000103000000000000000103000000000000000103000000000000000103000000000000000103",
)

// This selector exists only in the synthetic ArbitrumInternalTx dispatched
// by ApplyInternalTxUpdate. It uses the existing StartBlock argument layout.
var gl3A14StartBlockMethodID = [4]byte(crypto.Keccak256([]byte("startGL3A14Block(uint256,uint64,uint64,uint64)"))[:4])

func shouldActivateGL3A14FromInbox(
	arbOSVersion uint64,
	config *params.ChainConfig,
	l1 *arbostypes.L1IncomingMessageHeader,
	body []byte,
	priorDelayed, delayedRead uint64,
) bool {
	if arbOSVersion != params.ArbosVersion_61 || !config.IsGL3A14(params.ArbosVersion_GL3A14) ||
		l1.Kind != arbostypes.L1MessageType_L2Message || l1.Poster != params.GL3A14AuthorityAlias() ||
		priorDelayed == math.MaxUint64 || delayedRead != priorDelayed+1 || !bytes.Equal(body, gl3A14ActivationMessage) {
		return false
	}
	index, err := l1.SeqNum()
	return err == nil && index == priorDelayed
}
