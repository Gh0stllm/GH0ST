// SPDX-License-Identifier: GPL-3.0-or-later
package arbos

// GhostChessIsObserver distinguishes local recording/replay/prefetch work from
// the live commit path. It only controls an execution cache, never arithmetic,
// consensus gas, storage writes or which proof inputs are authenticated.
func (p *TxProcessor) GhostChessIsObserver() bool {
	if p.msg == nil || p.msg.TxRunContext == nil {
		return false
	}
	run := p.msg.TxRunContext
	return run.IsRecording() || !run.IsCommitMode()
}
