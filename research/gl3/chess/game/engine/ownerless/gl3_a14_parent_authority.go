// SPDX-License-Identifier: GPL-3.0-or-later
package params

import "github.com/ethereum/go-ethereum/common"

// GL3A14AuthorityAlias is the ERC20Inbox alias of the receipt-bound
// Robinhood UpgradeExecutor. Its authority is limited to A14.
func GL3A14AuthorityAlias() common.Address {
	return common.HexToAddress("0xb743b4c45726c779086f60d8b09bee7b09ba3652")
}
