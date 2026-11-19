// SPDX-License-Identifier: GPL-3.0-or-later
package precompiles

import (
	"errors"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/params"
)

const GL3PostingFeesABI = `[
 {"name":"postingPrice","type":"function","stateMutability":"view","inputs":[],"outputs":[{"name":"price","type":"uint256"}]},
 {"name":"setPostingPrice","type":"function","stateMutability":"nonpayable","inputs":[{"name":"expected","type":"uint256"},{"name":"replacement","type":"uint256"}],"outputs":[]},
 {"name":"PostingPriceSet","type":"event","anonymous":false,"inputs":[{"name":"previousPrice","type":"uint256","indexed":false},{"name":"newPrice","type":"uint256","indexed":false}]}
]`

type ArbGL3PostingFees struct {
	Address                addr
	PostingPriceSet        func(ctx, mech, *big.Int, *big.Int) error
	PostingPriceSetGasCost func(*big.Int, *big.Int) (uint64, error)
}

func makeGL3PostingFeesPrecompile() (addr, *Precompile) {
	address, precompile := MakePrecompile(
		&bind.MetaData{ABI: GL3PostingFeesABI},
		&ArbGL3PostingFees{Address: params.GL3PostingFeesAddress()},
	)
	precompile.arbosVersion = params.ArbosVersion_GL3PostingFees
	return address, precompile
}

// PostingPrice returns the price of one parent calldata gas unit in GL3 wei.
func (p *ArbGL3PostingFees) PostingPrice(c ctx, evm mech) (*big.Int, error) {
	return c.State.L1PricingState().PricePerUnit()
}

// SetPostingPrice changes only the current posting price. Nitro's batch
// controller continues to update the same price after an ordinary report.
func (p *ArbGL3PostingFees) SetPostingPrice(c ctx, evm mech, expected, replacement *big.Int) error {
	if !evm.ChainConfig().IsGL3PostingFees(c.State.ArbOSVersion()) || !a14ParentBootstrapAuthorized(c, evm) {
		return errors.New("GL3 posting fee update requires the canonical Robinhood executor")
	}
	if expected == nil || replacement == nil || replacement.Sign() <= 0 || replacement.BitLen() > 256 {
		return errors.New("GL3 posting fee update requires a positive uint256 replacement")
	}
	pricing := c.State.L1PricingState()
	previous, err := pricing.PricePerUnit()
	if err != nil {
		return err
	}
	if previous.Cmp(expected) != 0 {
		return errors.New("GL3 posting fee price changed before the authorized update")
	}
	if err := pricing.SetPricePerUnit(replacement); err != nil {
		return err
	}
	return p.PostingPriceSet(c, evm, previous, replacement)
}
