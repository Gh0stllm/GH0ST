package checkpoint

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestMain(m *testing.M) {
	if runtime.GOOS != "linux" {
		os.Stderr.WriteString("Runpod Linux only; no local tests\n")
		os.Exit(2)
	}
	os.Exit(m.Run())
}
func smallImages() (Image, Image) {
	seed := Image{Memory: make([]byte, 65536), Globals: []Global{{"gl3_global_0", 9}, {"gl3_global_98", 0}, {"gl3_global_99", 99}}}
	for i := 64; i < 96; i++ {
		seed.Memory[i] = 0x7f
	}
	im := Image{Memory: bytes.Clone(seed.Memory), Globals: copyGlobals(seed.Globals)}
	for i := 0; i < 32; i++ {
		im.Memory[i] = byte(i + 1)
	}
	clear(im.Memory[64:96])
	im.Globals[0].Value = 17
	return seed, im
}
func encoded(t *testing.T, seed, im Image) []byte {
	t.Helper()
	var b bytes.Buffer
	if e := Encode(&b, seed, im); e != nil {
		t.Fatal(e)
	}
	return b.Bytes()
}
func TestCodecPreservesZerosGlobalsAndAllBytes(t *testing.T) {
	seed, im := smallImages()
	data := encoded(t, seed, im)
	out, e := Decode(bytes.NewReader(data), seed)
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Equal(out.Memory, im.Memory) || !sameGlobals(out.Globals, im.Globals) {
		t.Fatal("state lost")
	}
	if !bytes.Equal(out.Memory[64:96], make([]byte, 32)) {
		t.Fatal("zero transition lost")
	}
	if !bytes.Equal(data, encoded(t, seed, im)) {
		t.Fatal("non-deterministic bytes")
	}
}
func TestCodecZeroExtendsGrowthWithoutDroppingState(t *testing.T) {
	seed, im := smallImages()
	im.Memory = append(im.Memory, make([]byte, 65536)...)
	im.Memory[len(im.Memory)-1] = 42
	out, e := Decode(bytes.NewReader(encoded(t, seed, im)), seed)
	if e != nil || !bytes.Equal(out.Memory, im.Memory) {
		t.Fatal("growth", e)
	}
}
func bitmapOffset(data []byte) int {
	at := 110
	count := int(binary.LittleEndian.Uint16(data[108:110]))
	for i := 0; i < count; i++ {
		n := int(binary.LittleEndian.Uint16(data[at : at+2]))
		at += 2 + n + 8
	}
	return at
}
func TestCodecRejectsCorruptionBoundsMissingAndExtra(t *testing.T) {
	seed, im := smallImages()
	data := encoded(t, seed, im)
	meta := bitmapOffset(data)
	cases := map[string]func([]byte) []byte{
		"magic": func(b []byte) []byte { b[0] ^= 1; return b }, "module": func(b []byte) []byte { b[8] ^= 1; return b }, "genesis root": func(b []byte) []byte { b[40] ^= 1; return b }, "image root": func(b []byte) []byte { b[72] ^= 1; return b },
		"zero memory": func(b []byte) []byte { binary.LittleEndian.PutUint32(b[104:108], 0); return b }, "overbound memory": func(b []byte) []byte { binary.LittleEndian.PutUint32(b[104:108], MaxMemory+65536); return b }, "misaligned memory": func(b []byte) []byte { binary.LittleEndian.PutUint32(b[104:108], 65537); return b },
		"global count": func(b []byte) []byte { binary.LittleEndian.PutUint16(b[108:110], 255); return b }, "global bound": func(b []byte) []byte { binary.LittleEndian.PutUint16(b[110:112], 129); return b }, "global name": func(b []byte) []byte { b[112] ^= 1; return b },
		"bitmap size": func(b []byte) []byte { binary.LittleEndian.PutUint32(b[meta:meta+4], 100); return b }, "bitmap count": func(b []byte) []byte { binary.LittleEndian.PutUint32(b[meta+4:meta+8], 0); return b }, "payload": func(b []byte) []byte { b[len(b)-1] ^= 1; return b },
		"redundant word": func(b []byte) []byte {
			start := meta + 8 + int(binary.LittleEndian.Uint32(b[meta:meta+4]))
			clear(b[start : start+32])
			return b
		}, "missing byte": func(b []byte) []byte { return b[:len(b)-1] }, "extra byte": func(b []byte) []byte { return append(b, 0) },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			if _, e := Decode(bytes.NewReader(mutate(bytes.Clone(data))), seed); e == nil {
				t.Fatal("accepted corrupted checkpoint")
			}
		})
	}
}
func TestCodecRejectsInvalidSourceGlobalIdentity(t *testing.T) {
	seed, im := smallImages()
	im.Globals[1].Name = im.Globals[0].Name
	if e := Encode(new(bytes.Buffer), seed, im); e == nil {
		t.Fatal("duplicate global")
	}
	_, im = smallImages()
	im.Globals[1].Name = "gl3_global_97"
	if e := Encode(new(bytes.Buffer), seed, im); e == nil {
		t.Fatal("wrong exported global")
	}
}

// The real fixture is authenticated PRETERMINAL data, never re-labelled complete.
func TestFrozenAuthenticatedPreterminalCodec(t *testing.T) {
	dir := os.Getenv("GL3_CHECKPOINT_FIXTURE")
	if dir == "" {
		t.Fatal("frozen Runpod fixture required")
	}
	var meta struct {
		SeedGlobals, ImageGlobals     []Global
		ImageRoot, ImageSHA256, Scope string
		Completed                     bool
	}
	b, e := os.ReadFile(filepath.Join(dir, "fixture.json"))
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(b, &meta); e != nil {
		t.Fatal(e)
	}
	if meta.Completed {
		t.Fatal("preterminal fixture mislabeled completed")
	}
	seedMemory, e := os.ReadFile(filepath.Join(dir, "seed.bin"))
	if e != nil {
		t.Fatal(e)
	}
	memory, e := os.ReadFile(filepath.Join(dir, "image.bin"))
	if e != nil {
		t.Fatal(e)
	}
	digest := sha256.Sum256(memory)
	if hex.EncodeToString(digest[:]) != meta.ImageSHA256 {
		t.Fatal("fixture bytes changed")
	}
	seed := Image{seedMemory, meta.SeedGlobals}
	im := Image{memory, meta.ImageGlobals}
	root, e := ImageRoot(im)
	if e != nil || hex.EncodeToString(root[:]) != meta.ImageRoot {
		t.Fatal("authenticated source root", e)
	}
	data := encoded(t, seed, im)
	out, e := Decode(bytes.NewReader(data), seed)
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Equal(out.Memory, im.Memory) || !sameGlobals(out.Globals, im.Globals) {
		t.Fatal("frozen image/TT/history bytes changed")
	}
	got, e := ImageRoot(out)
	if e != nil || got != root {
		t.Fatal("root mismatch", e)
	}
	result := map[string]any{"passed": true, "scope": "Authenticated PRETERMINAL codec only; no engine, completed-decision or STF/guest proof pass", "completedDecision": false, "memoryBytes": len(memory), "encodedBytes": len(data), "allMemoryBytesMatch": true, "allGlobalsMatch": true, "imageRoot": hex.EncodeToString(root[:]), "imageSHA256": meta.ImageSHA256, "allExecutionOnRunpod": true, "engineExecuted": false}
	outJSON, _ := json.MarshalIndent(result, "", "  ")
	if evidence := os.Getenv("GL3_CHECKPOINT_EVIDENCE"); evidence != "" {
		if e = os.WriteFile(filepath.Join(evidence, "frozen-codec-result.json"), append(outJSON, '\n'), 0600); e != nil {
			t.Fatal(e)
		}
	}
	t.Log(string(outJSON))
}
