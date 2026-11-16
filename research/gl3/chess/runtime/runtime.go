// SPDX-License-Identifier: GPL-3.0-or-later
package chessruntime

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"strings"
	"sync"
)

const Nodes uint64 = 24000000
const HashMiB uint32 = 128
const MaxState = 192 * 1024 * 1024
const StartFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
const NNUESHA256 = "1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2"
const PolicySHA256 = "a5639c5d2c8a700a187e803add4685823535d5edf59306e6097609b0f1aa6daf"

var ErrInvalid = errors.New("invalid full-strength chess request")
var ErrEngine = errors.New("full-strength chess transition failed")
var engineMu sync.Mutex

type Result struct {
	Move     string
	Nodes    uint64
	Depth    uint32
	State    []byte
	StateSHA [32]byte
}

func ValidMove(s string) bool {
	if len(s) != 4 && len(s) != 5 {
		return false
	}
	if s[0] < 'a' || s[0] > 'h' || s[1] < '1' || s[1] > '8' || s[2] < 'a' || s[2] > 'h' || s[3] < '1' || s[3] > '8' {
		return false
	}
	return len(s) == 4 || strings.ContainsRune("qrbn", rune(s[4]))
}
func execute(newGame bool, moves []string, state []byte) (Result, error) {
	if len(state) > MaxState || len(moves) > 1024 {
		return Result{}, ErrInvalid
	}
	for _, m := range moves {
		if !ValidMove(m) {
			return Result{}, ErrInvalid
		}
	}
	if newGame && (len(moves) != 0 || len(state) != 0) {
		return Result{}, ErrInvalid
	}
	if !newGame && (len(state) == 0 || len(moves)%2 != 1) {
		return Result{}, ErrInvalid
	}
	history := strings.Join(moves, " ")
	if len(history) > 8192 {
		return Result{}, ErrInvalid
	}
	request := make([]byte, 16+len(StartFEN)+len(history)+len(state))
	op := uint32(1)
	if newGame {
		op = 0
	}
	binary.LittleEndian.PutUint32(request, op)
	binary.LittleEndian.PutUint32(request[4:], uint32(len(StartFEN)))
	binary.LittleEndian.PutUint32(request[8:], uint32(len(history)))
	binary.LittleEndian.PutUint32(request[12:], uint32(len(state)))
	at := 16
	at += copy(request[at:], StartFEN)
	at += copy(request[at:], history)
	copy(request[at:], state)
	// Native C++ globals contain immutable tables but are initialized serially.
	// Every decision reconstructs an Engine from authoritative retained bytes.
	engineMu.Lock()
	out, err := executeRaw(request)
	engineMu.Unlock()
	if err != nil {
		return Result{}, err
	}
	if len(out) < 24 || binary.LittleEndian.Uint32(out) != 0 {
		return Result{}, ErrEngine
	}
	nodes := binary.LittleEndian.Uint64(out[4:])
	depth := binary.LittleEndian.Uint32(out[12:])
	nm := int(binary.LittleEndian.Uint32(out[16:]))
	ns := int(binary.LittleEndian.Uint32(out[20:]))
	if nm > 5 || ns > MaxState || 24+nm+ns != len(out) {
		return Result{}, ErrEngine
	}
	move := string(out[24 : 24+nm])
	if newGame {
		if nm != 0 || nodes != 0 || depth != 0 {
			return Result{}, ErrEngine
		}
	} else if !ValidMove(move) || (nodes < Nodes && depth != 245) {
		return Result{}, ErrEngine
	}
	body := out[24+nm:]
	return Result{move, nodes, depth, body, sha256.Sum256(body)}, nil
}
func NewGame() (Result, error)                          { return execute(true, nil, nil) }
func Play(moves []string, state []byte) (Result, error) { return execute(false, moves, state) }
