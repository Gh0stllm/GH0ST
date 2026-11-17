//go:build !gl3_checkpoint_integration

package precompiles

import (
	"github.com/ethereum/go-ethereum/common"
	"testing"
)

func TestGL3CheckpointProfileDisabled(t *testing.T) {
	if Precompiles()[common.HexToAddress("0xa15")] != nil {
		t.Fatal("opt-in ABI leaked into default profile")
	}
	_, p := makeGhostChessSlicesPrecompile()
	if p.methodsByName["CheckpointBegin"] != nil {
		t.Fatal("legacy ABI changed")
	}
}
