// SPDX-License-Identifier: GPL-3.0-or-later
package arbnode

import (
	"errors"

	"github.com/ethereum/go-ethereum/params"
	"github.com/offchainlabs/nitro/arbos/arbostypes"
)

// Reserved authority messages must come from the parent inbox. Signed feed,
// archive backfill and Redis messages are not parent-inbox evidence.
func (s *TransactionStreamer) rejectUnconfirmedGL3A14Authority(messages []arbostypes.MessageWithMetadataAndBlockInfo) error {
	if !s.chainConfig.IsGL3A14(params.ArbosVersion_GL3A14) {
		return nil
	}
	for _, item := range messages {
		msg := item.MessageWithMeta.Message
		if msg != nil && msg.Header != nil && msg.Header.Poster == params.GL3A14AuthorityAlias() {
			return errors.New("GL3 A14 authority message requires the parent inbox")
		}
	}
	return nil
}
