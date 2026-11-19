// SPDX-License-Identifier: GPL-3.0-or-later
package params

import "github.com/ethereum/go-ethereum/common"

func GL3PostingFeesAddress() common.Address {
	return common.Address{18: 0x0a, 19: 0x15}
}

// GL3PostingFeesAuthorityAlias is the aliased Robinhood UpgradeExecutor
// already used to authorize the A14 transition.
func GL3PostingFeesAuthorityAlias() common.Address {
	return GL3A14AuthorityAlias()
}
