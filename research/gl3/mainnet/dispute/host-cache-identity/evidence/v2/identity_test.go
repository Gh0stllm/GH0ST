// SPDX-License-Identifier: GPL-3.0-or-later
package hostcacheidentity

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"math/rand"
	"os"
	"reflect"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/offchainlabs/nitro/arbutil"
	"github.com/offchainlabs/nitro/daprovider"
	"github.com/offchainlabs/nitro/validator"
	"github.com/offchainlabs/nitro/validator/server_api"
)

var h1 = common.HexToHash("0x01")
var h2 = common.HexToHash("0x02")
var h3 = common.HexToHash("0x03")

func fixture() *validator.ValidationInput {
	return &validator.ValidationInput{
		Id: 7, HasDelayedMsg: true, DelayedMsgNr: 11,
		Preimages:  daprovider.PreimagesMap{0: {h1: []byte("alpha"), h2: []byte("beta")}, 1: {h1: []byte("other-type")}},
		UserWasms:  map[rawdb.WasmTarget]map[common.Hash][]byte{"wavm": {h1: []byte("wasm-one"), h2: []byte("wasm-two")}, "amd64": {h1: []byte("other-target")}},
		BatchInfo:  []validator.BatchInfo{{Number: 42, Data: []byte("batch-one")}, {Number: 43, Data: []byte("batch-two")}},
		DelayedMsg: []byte("delayed-message"),
		StartState: validator.GoGlobalState{BlockHash: h1, SendRoot: h2, Batch: 42, PosInBatch: 5}, DebugChain: true,
	}
}
func digest(t *testing.T, in *validator.ValidationInput) common.Hash {
	t.Helper()
	v, e := Digest(in)
	if e != nil {
		t.Fatal(e)
	}
	return v
}
func copyInput(t *testing.T, in *validator.ValidationInput) *validator.ValidationInput {
	t.Helper()
	v, _, e := CloneAndKey(h3, in, true)
	if e != nil {
		t.Fatal(e)
	}
	return v
}

func TestSchemaAndNil(t *testing.T) {
	if err := requireSchema(); err != nil {
		t.Fatal(err)
	}
	if _, err := Digest(nil); err == nil {
		t.Fatal("nil digest accepted")
	}
	if _, err := KeyOwnedDecoded(h1, nil, true); err == nil {
		t.Fatal("nil owned input accepted")
	}
	if v, _, err := CloneAndKey(h1, nil, true); err == nil || v != nil {
		t.Fatal("nil snapshot accepted")
	}
}

func TestMapOrderInvariance(t *testing.T) {
	original := fixture()
	want := digest(t, original)
	for seed := int64(0); seed < 64; seed++ {
		t.Run(stringName(seed), func(t *testing.T) {
			rng := rand.New(rand.NewSource(seed))
			in := copyInput(t, original)
			in.Preimages = make(daprovider.PreimagesMap)
			types := []arbutil.PreimageType{0, 1}
			rng.Shuffle(len(types), func(i, j int) { types[i], types[j] = types[j], types[i] })
			for _, typ := range types {
				keys := sortedHashes(original.Preimages[typ])
				rng.Shuffle(len(keys), func(i, j int) { keys[i], keys[j] = keys[j], keys[i] })
				group := make(map[common.Hash][]byte)
				for _, key := range keys {
					group[key] = cloneBytes(original.Preimages[typ][key])
				}
				in.Preimages[typ] = group
			}
			in.UserWasms = make(map[rawdb.WasmTarget]map[common.Hash][]byte)
			targets := []rawdb.WasmTarget{"wavm", "amd64"}
			rng.Shuffle(len(targets), func(i, j int) { targets[i], targets[j] = targets[j], targets[i] })
			for _, target := range targets {
				keys := sortedHashes(original.UserWasms[target])
				rng.Shuffle(len(keys), func(i, j int) { keys[i], keys[j] = keys[j], keys[i] })
				group := make(map[common.Hash][]byte)
				for _, key := range keys {
					group[key] = cloneBytes(original.UserWasms[target][key])
				}
				in.UserWasms[target] = group
			}
			if got := digest(t, in); got != want {
				t.Fatal("map insertion order changed key", seed, got, want)
			}
		})
	}
}
func stringName(i int64) string {
	const digits = "0123456789"
	return "seed-" + string([]byte{digits[i/10], digits[i%10]})
}

func TestEveryExecutionFieldChangesIdentity(t *testing.T) {
	base := fixture()
	want := digest(t, base)
	cases := []struct {
		name   string
		change func(*validator.ValidationInput)
	}{
		{"Id", func(v *validator.ValidationInput) { v.Id++ }},
		{"HasDelayedMsg", func(v *validator.ValidationInput) { v.HasDelayedMsg = !v.HasDelayedMsg }},
		{"DelayedMsgNr", func(v *validator.ValidationInput) { v.DelayedMsgNr++ }},
		{"StartBlockHash", func(v *validator.ValidationInput) { v.StartState.BlockHash[0] ^= 1 }},
		{"StartSendRoot", func(v *validator.ValidationInput) { v.StartState.SendRoot[0] ^= 1 }},
		{"StartBatch", func(v *validator.ValidationInput) { v.StartState.Batch++ }},
		{"StartPosition", func(v *validator.ValidationInput) { v.StartState.PosInBatch++ }},
		{"DebugChain", func(v *validator.ValidationInput) { v.DebugChain = !v.DebugChain }},
		{"PreimageType", func(v *validator.ValidationInput) { v.Preimages[9] = v.Preimages[0]; delete(v.Preimages, 0) }},
		{"PreimageHash", func(v *validator.ValidationInput) {
			v.Preimages[0][h3] = v.Preimages[0][h1]
			delete(v.Preimages[0], h1)
		}},
		{"PreimageBytes", func(v *validator.ValidationInput) { v.Preimages[0][h1][0] ^= 1 }},
		{"PreimageLength", func(v *validator.ValidationInput) { v.Preimages[0][h1] = append(v.Preimages[0][h1], 0) }},
		{"PreimageEntryCount", func(v *validator.ValidationInput) { v.Preimages[0][h3] = []byte{} }},
		{"PreimageGroupCount", func(v *validator.ValidationInput) { v.Preimages[9] = map[common.Hash][]byte{} }},
		{"BatchNumber", func(v *validator.ValidationInput) { v.BatchInfo[0].Number++ }},
		{"BatchBytes", func(v *validator.ValidationInput) { v.BatchInfo[0].Data[0] ^= 1 }},
		{"BatchLength", func(v *validator.ValidationInput) { v.BatchInfo[0].Data = append(v.BatchInfo[0].Data, 0) }},
		{"BatchOrder", func(v *validator.ValidationInput) { v.BatchInfo[0], v.BatchInfo[1] = v.BatchInfo[1], v.BatchInfo[0] }},
		{"BatchCount", func(v *validator.ValidationInput) { v.BatchInfo = append(v.BatchInfo, validator.BatchInfo{}) }},
		{"DelayedBytes", func(v *validator.ValidationInput) { v.DelayedMsg[0] ^= 1 }},
		{"DelayedLength", func(v *validator.ValidationInput) { v.DelayedMsg = append(v.DelayedMsg, 0) }},
		{"WasmTarget", func(v *validator.ValidationInput) {
			v.UserWasms["arm64"] = v.UserWasms["amd64"]
			delete(v.UserWasms, "amd64")
		}},
		{"WasmModuleHash", func(v *validator.ValidationInput) {
			v.UserWasms["wavm"][h3] = v.UserWasms["wavm"][h1]
			delete(v.UserWasms["wavm"], h1)
		}},
		{"WasmBytes", func(v *validator.ValidationInput) { v.UserWasms["wavm"][h1][0] ^= 1 }},
		{"WasmLength", func(v *validator.ValidationInput) { v.UserWasms["wavm"][h1] = append(v.UserWasms["wavm"][h1], 0) }},
		{"WasmModuleCount", func(v *validator.ValidationInput) { v.UserWasms["wavm"][h3] = []byte{} }},
		{"WasmTargetCount", func(v *validator.ValidationInput) { v.UserWasms["new-empty-target"] = map[common.Hash][]byte{} }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v := copyInput(t, base)
			tc.change(v)
			if digest(t, v) == want {
				t.Fatal("field mutation reused identity")
			}
		})
	}
}

func TestModuleAndBoldSeparateKeyComponents(t *testing.T) {
	in := fixture()
	a, e := KeyOwnedDecoded(h1, in, false)
	if e != nil {
		t.Fatal(e)
	}
	b, e := KeyOwnedDecoded(h2, in, false)
	if e != nil {
		t.Fatal(e)
	}
	c, e := KeyOwnedDecoded(h1, in, true)
	if e != nil {
		t.Fatal(e)
	}
	if a == b || a == c || b == c {
		t.Fatal("root/wrapper mode did not separate keys")
	}
	if a.InputSHA256 != b.InputSHA256 || a.InputSHA256 != c.InputSHA256 {
		t.Fatal("input hash unexpectedly includes separate components")
	}
	values := map[Key]int{a: 1, b: 2, c: 3}
	if len(values) != 3 {
		t.Fatal("keys are not independently comparable")
	}
}

func TestNilEmptyAndGroupBoundaries(t *testing.T) {
	empty := &validator.ValidationInput{}
	fullEmpty := &validator.ValidationInput{Preimages: daprovider.PreimagesMap{}, UserWasms: map[rawdb.WasmTarget]map[common.Hash][]byte{}, BatchInfo: []validator.BatchInfo{}, DelayedMsg: []byte{}}
	if digest(t, empty) != digest(t, fullEmpty) {
		t.Fatal("nil/empty top-level collections differ")
	}
	for _, in := range []*validator.ValidationInput{empty, fullEmpty} {
		out, _, err := CloneAndKey(h1, in, false)
		if err != nil || !reflect.DeepEqual(in, out) {
			t.Fatal("snapshot changed nil/empty representation", err)
		}
	}
	a := &validator.ValidationInput{Preimages: daprovider.PreimagesMap{0: nil}, UserWasms: map[rawdb.WasmTarget]map[common.Hash][]byte{"wavm": nil}, BatchInfo: []validator.BatchInfo{{}}}
	b := &validator.ValidationInput{Preimages: daprovider.PreimagesMap{0: {}}, UserWasms: map[rawdb.WasmTarget]map[common.Hash][]byte{"wavm": {}}, BatchInfo: []validator.BatchInfo{{Data: []byte{}}}}
	if digest(t, a) != digest(t, b) {
		t.Fatal("nil/empty present groups or byte slices differ")
	}
	if digest(t, a) == digest(t, empty) {
		t.Fatal("present empty groups/list omitted from structure")
	}
	pairs := [][2]*validator.ValidationInput{
		{{Preimages: daprovider.PreimagesMap{0: {h1: []byte("ab"), h2: []byte("c")}}}, {Preimages: daprovider.PreimagesMap{0: {h1: []byte("a"), h2: []byte("bc")}}}},
		{{Preimages: daprovider.PreimagesMap{0: {h1: []byte("a")}, 1: {h2: []byte("b")}}}, {Preimages: daprovider.PreimagesMap{0: {h1: []byte("a"), h2: []byte("b")}}}},
		{{UserWasms: map[rawdb.WasmTarget]map[common.Hash][]byte{"ab": {h1: []byte("c")}}}, {UserWasms: map[rawdb.WasmTarget]map[common.Hash][]byte{"a": {h1: []byte("bc")}}}},
		{{BatchInfo: []validator.BatchInfo{{Data: []byte("a")}, {Data: []byte("b")}}}, {BatchInfo: []validator.BatchInfo{{Data: []byte("ab")}}}},
		{{DelayedMsg: []byte("ab"), BatchInfo: []validator.BatchInfo{{Data: []byte("c")}}}, {DelayedMsg: []byte("a"), BatchInfo: []validator.BatchInfo{{Data: []byte("bc")}}}},
		{{Preimages: daprovider.PreimagesMap{0: {h1: []byte("same")}}}, {UserWasms: map[rawdb.WasmTarget]map[common.Hash][]byte{"wavm": {h1: []byte("same")}}}},
	}
	for i, pair := range pairs {
		t.Run(stringName(int64(i)), func(t *testing.T) {
			if digest(t, pair[0]) == digest(t, pair[1]) {
				t.Fatal("structural boundary collision")
			}
		})
	}
}

func TestCloneOwnsEveryNestedByteAndMap(t *testing.T) {
	original := fixture()
	shared := []byte("shared-alias")
	original.Preimages[0][h1] = shared
	original.UserWasms["wavm"][h1] = shared
	original.BatchInfo[0].Data = shared
	original.DelayedMsg = shared
	owned, key, err := CloneAndKey(h3, original, true)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(owned, original) {
		t.Fatal("snapshot did not preserve all input fields")
	}
	stable := func() {
		t.Helper()
		if digest(t, owned) != key.InputSHA256 {
			t.Fatal("external mutation changed owned snapshot")
		}
	}
	shared[0] ^= 1
	stable()
	for _, group := range original.Preimages {
		for _, data := range group {
			if len(data) > 0 {
				data[0] ^= 1
				stable()
			}
		}
	}
	for _, group := range original.UserWasms {
		for _, data := range group {
			if len(data) > 0 {
				data[0] ^= 1
				stable()
			}
		}
	}
	for i := range original.BatchInfo {
		original.BatchInfo[i].Number++
		original.BatchInfo[i].Data[0] ^= 1
		stable()
	}
	original.Id++
	original.HasDelayedMsg = false
	original.DelayedMsgNr++
	original.DebugChain = false
	original.StartState.BlockHash = h3
	stable()
	delete(original.Preimages[0], h2)
	original.Preimages[0][h3] = []byte("new")
	original.Preimages[2] = map[common.Hash][]byte{h1: []byte("new-group")}
	stable()
	delete(original.UserWasms["wavm"], h2)
	original.UserWasms["wavm"][h3] = []byte("new")
	original.UserWasms["new-target"] = map[common.Hash][]byte{h1: []byte("new-group")}
	stable()
	if digest(t, original) == key.InputSHA256 {
		t.Fatal("mutations did not change source input")
	}
	// The returned pointer is intentionally NOT an immutable type. Its recipient
	// must retain it privately; mutation must change the key, never be hidden.
	owned.DelayedMsg[0] ^= 1
	if digest(t, owned) == key.InputSHA256 {
		t.Fatal("recipient mutation was not visible")
	}
}

func TestOriginalInputDigestOnly(t *testing.T) {
	path, out := os.Getenv("GL3_IDENTITY_ORIGINAL_INPUT"), os.Getenv("GL3_IDENTITY_ORIGINAL_OUTPUT")
	if path == "" || out == "" {
		t.Skip("explicit original input/output paths required for standalone digest-only test")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		t.Fatal(err)
	}
	fileSHA := hex.EncodeToString(h.Sum(nil))
	if fileSHA != "bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90" {
		t.Fatal("original input bytes mismatch")
	}
	if _, err = f.Seek(0, 0); err != nil {
		t.Fatal(err)
	}
	var encoded server_api.InputJSON
	if err = json.NewDecoder(f).Decode(&encoded); err != nil {
		t.Fatal(err)
	}
	in, err := server_api.ValidationInputFromJson(&encoded)
	if err != nil {
		t.Fatal(err)
	}
	root := common.HexToHash("0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086")
	key, err := KeyOwnedDecoded(root, in, true)
	if err != nil {
		t.Fatal(err)
	}
	var count, size uint64
	for _, group := range in.Preimages {
		for _, data := range group {
			count++
			size += uint64(len(data))
		}
	}
	result := map[string]any{"schema": Schema, "file": path, "fileSHA256": fileSHA, "fileBytes": n, "key": key, "decodedInputID": in.Id, "startState": in.StartState, "preimageCount": count, "preimageBytes": size, "moduleRootSeparate": true, "useBoldMachineSeparate": true, "inputOwnership": "fresh exclusive JSON decode, retained by this test only", "digestOnly": true, "replayExecuted": false, "lifecycleExecuted": false}
	b, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(out, append(b, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
}
