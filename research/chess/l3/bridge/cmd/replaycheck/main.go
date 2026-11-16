// Fixture IO belongs only to this command. bridge.Engine performs no IO and
// receives all authoritative model/job data through the persistent store.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	b "github.com/Gh0stllm/GH0ST/l3/bridge"
	"os"
	"path/filepath"
)

type words map[b.Word]b.Word

func (w words) Get(k b.Word) (b.Word, error) { return w[k], nil }
func (w words) Apply(writes []b.WordWrite) error {
	for _, v := range writes {
		w[v.Key] = v.Value
	}
	return nil
}
func main() {
	if len(os.Args) < 2 {
		panic("usage: replaycheck fixture-root [complete]")
	}
	root := os.Args[1]
	module, e := os.ReadFile(filepath.Join(root, "llm/.cache/runtime.wasm"))
	if e != nil {
		panic(e)
	}
	model, e := os.ReadFile(filepath.Join(root, "llm/.cache/model.bin"))
	if e != nil {
		panic(e)
	}
	state := words{}
	s := b.WordAdapter{Words: state}
	modelID, e := b.Register(s, module, model)
	if e != nil {
		panic(e)
	}
	engine, e := b.New(s, modelID)
	if e != nil {
		panic(e)
	}
	defer engine.Close()
	var owner b.Owner
	owner[19] = 1
	var id b.Hash
	id[31] = 88
	p, e := engine.Begin(s, owner, id, 7454)
	if e != nil {
		panic(e)
	}
	commits := 0
	for {
		p, e = engine.Advance(s, owner, id, p.Generation, 512, b.MaxChunksPerCommit)
		if e != nil {
			panic(e)
		}
		commits++
		if p.Done || len(os.Args) < 3 {
			break
		}
	}
	logitsHash := ""
	if p.Done {
		data, e := engine.Logits(s, owner, id)
		if e != nil {
			panic(e)
		}
		h := sha256.Sum256(data)
		logitsHash = hex.EncodeToString(h[:])
	}
	out := struct {
		Scope                               string
		Done                                bool
		BestToken, Phase, KernelStep        uint32
		Commits                             int
		CheckpointSHA256, LogitsI32LESHA256 string
	}{
		"Local Go/WASI fixture command, not a Nitro prover", p.Done, p.BestToken, p.Phase, p.KernelStep, commits, hex.EncodeToString(p.CheckpointSHA[:]), logitsHash}
	raw, e := json.Marshal(out)
	if e != nil {
		panic(e)
	}
	fmt.Println(string(raw))
}
