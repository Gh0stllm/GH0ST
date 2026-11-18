// SPDX-License-Identifier: GPL-3.0-or-later
// group40 emits the reference trace from the pinned portable runtime.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"

	slicedchess "github.com/Gh0stllm/GH0ST/gl3/slicedchess"
)

const (
	history         = "e2e4"
	groupSize       = 40
	targetNodes     = 24_000_000
	quantumNodes    = 2_048
	terminalQuanta  = 9_853
	terminalNodes   = 24_000_033
	terminalDepth   = 38
	terminalMove    = "e7e5"
	canonicalBytes  = 163_085_439
	moduleSHA256    = "1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc"
	canonicalSHA256 = "5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6"
)

type group struct {
	StartCursor   uint32 `json:"startCursor"`
	EndCursor     uint32 `json:"endCursor"`
	Quanta        uint32 `json:"quanta"`
	ObservedNodes uint64 `json:"observedNodes"`
	Pending       bool   `json:"pending"`
}

type report struct {
	Scope                   string  `json:"scope"`
	ModuleSHA256            string  `json:"moduleSHA256"`
	History                 string  `json:"history"`
	TargetNodes             uint64  `json:"targetNodes"`
	QuantumNodes            uint32  `json:"quantumNodes"`
	GroupSize               uint32  `json:"groupSize"`
	TotalGroups             int     `json:"totalGroups"`
	FullGroups              int     `json:"fullGroups"`
	FinalGroupQuanta        uint32  `json:"finalGroupQuanta"`
	TotalQuanta             uint32  `json:"totalQuanta"`
	ActualNodes             uint64  `json:"actualNodes"`
	Depth                   uint32  `json:"depth"`
	Move                    string  `json:"move"`
	CanonicalCheckpointSize int     `json:"canonicalCheckpointSize"`
	CanonicalCheckpointHash string  `json:"canonicalCheckpointSHA256"`
	Groups                  []group `json:"groups"`
}

func run() (report, error) {
	moduleHash := hex.EncodeToString(slicedchess.ModuleSHA[:])
	if moduleHash != moduleSHA256 || slicedchess.TargetNodes != targetNodes || slicedchess.Quantum != quantumNodes {
		return report{}, fmt.Errorf("reference runtime identity or search policy differs from the pinned fixture")
	}
	runtime, err := slicedchess.New(false)
	if err != nil {
		return report{}, fmt.Errorf("prepare reference runtime: %w", err)
	}
	defer runtime.Close()
	vm, err := runtime.Instantiate()
	if err != nil {
		return report{}, fmt.Errorf("create reference guest: %w", err)
	}
	defer vm.Close()
	if err := vm.Init(); err != nil {
		return report{}, fmt.Errorf("initialize reference guest: %w", err)
	}

	groups := make([]group, 0, (terminalQuanta+groupSize-1)/groupSize)
	var progress slicedchess.Progress
	for start := uint32(0); start < terminalQuanta; start += groupSize {
		end := min(start+groupSize, terminalQuanta)
		for cursor := start; cursor < end; cursor++ {
			previous := progress.Observed
			if cursor == 0 {
				progress, err = vm.Begin(history)
			} else {
				progress, err = vm.Advance()
			}
			if err != nil {
				return report{}, fmt.Errorf("quantum %d: %w", cursor+1, err)
			}
			if progress.Step != cursor+1 || progress.Observed < previous || progress.Pending != (cursor+1 < terminalQuanta) {
				return report{}, fmt.Errorf("quantum %d: unexpected reference progress %+v", cursor+1, progress)
			}
		}
		groups = append(groups, group{start, end, end - start, progress.Observed, progress.Pending})
	}
	if progress.Move != terminalMove || progress.Nodes != terminalNodes || progress.Depth != terminalDepth {
		return report{}, fmt.Errorf("terminal reference result differs from the pinned fixture: %+v", progress)
	}
	checkpoint, err := vm.Canonical()
	if err != nil {
		return report{}, fmt.Errorf("read canonical checkpoint: %w", err)
	}
	sum := sha256.Sum256(checkpoint)
	digest := hex.EncodeToString(sum[:])
	if len(checkpoint) != canonicalBytes || digest != canonicalSHA256 {
		return report{}, fmt.Errorf("canonical checkpoint differs from the pinned fixture: %d bytes, SHA-256 %s", len(checkpoint), digest)
	}
	return report{
		Scope:        "pinned portable Go/Wasm reference grouping, no Stylus or chain execution",
		ModuleSHA256: moduleHash, History: history, TargetNodes: targetNodes, QuantumNodes: quantumNodes,
		GroupSize: groupSize, TotalGroups: len(groups), FullGroups: terminalQuanta / groupSize,
		FinalGroupQuanta: groups[len(groups)-1].Quanta, TotalQuanta: progress.Step,
		ActualNodes: progress.Nodes, Depth: progress.Depth, Move: progress.Move,
		CanonicalCheckpointSize: len(checkpoint), CanonicalCheckpointHash: digest, Groups: groups,
	}, nil
}

func main() {
	result, err := run()
	if err == nil {
		out := json.NewEncoder(os.Stdout)
		out.SetIndent("", "  ")
		err = out.Encode(result)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
