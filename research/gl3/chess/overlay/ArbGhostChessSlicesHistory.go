// SPDX-License-Identifier: GPL-3.0-or-later
package precompiles

import (
	engine "github.com/Gh0stllm/GH0ST/gl3/chessruntime"
	"strings"
)

func validSliceHistory(old, history string) bool {
	if history != strings.Join(strings.Fields(history), " ") {
		return false
	}
	moves := strings.Fields(history)
	prior := strings.Fields(old)
	if len(moves)%2 != 1 || len(moves) != len(prior)+1 || len(moves) > 1024 {
		return false
	}
	for i, m := range moves {
		if !engine.ValidMove(m) || (i < len(prior) && m != prior[i]) {
			return false
		}
	}
	return true
}
