//go:build wasm && gl3aotproof

// SPDX-License-Identifier: GPL-3.0-or-later
// EXPERIMENTAL: isolated replay-machine variant, never the default node.
package slicedchess

import (
 "bytes"
 "crypto/sha256"
 "encoding/binary"
 "errors"
 "runtime"
 "sort"
 "strings"
 "unsafe"
)
const PageSize = 4096
const MaxMemory = 768*1024*1024
const Quantum = 2048
const TargetNodes = 24000000
var ErrState = errors.New("invalid GL3 chess continuation")
type Runtime struct { Globals []string }
type VM struct { R *Runtime; handle uint32; memory []byte; dead bool; dirty bool }
type Global struct { Name string; Value uint64 }
type Image struct { Memory []byte; Globals []Global }
type Progress struct { Pending bool; Step uint32; Observed,Nodes uint64; Depth uint32; Move string }

//go:wasmimport gl3aot execute
func execute(op,handle,a,b,c uint32,ptr unsafe.Pointer,n uint32) uint64
func bridge(op,handle,a,b,c uint32,data []byte)(uint64,error){
 var ptr unsafe.Pointer
 if len(data)>0 {ptr=unsafe.Pointer(&data[0])}
 result:=execute(op,handle,a,b,c,ptr,uint32(len(data)))
 runtime.KeepAlive(data)
 if result>>63!=0 {return 0,ErrState}
 return result,nil
}
func Shared()(*Runtime,error){return New(false)}
func New(_ bool)(*Runtime,error){return &Runtime{[]string{"gl3_global_0","gl3_global_98","gl3_global_99"}},nil}
func (r *Runtime) Close(){}
func (r *Runtime) Instantiate()(*VM,error){h,e:=bridge(0,0,0,0,0,nil);if e!=nil||h==0||h>0xffffffff{return nil,ErrState};return &VM{R:r,handle:uint32(h),dirty:true},nil}
func(v *VM) Close(){if v.handle!=0{bridge(1,v.handle,0,0,0,nil);v.handle=0};v.dead=true;v.memory=nil}
func(v *VM) invoke(op,a,b uint32)(uint64,error){
 if v.dead||v.handle==0{return 0,ErrState}
 n,e:=bridge(8,v.handle,op,a,b,nil);if e!=nil{v.dead=true};switch op {case 0,1,2,3,4,5,11:v.dirty=true};return n,e
}
func(v *VM) sync()error{
 n,e:=bridge(5,v.handle,0,0,0,nil);if e!=nil||n==0||n>MaxMemory||n%65536!=0{return ErrState}
 if len(v.memory)!=int(n){v.memory=make([]byte,n)}
 _,e=bridge(4,v.handle,0,0,0,v.memory);if e==nil{v.dirty=false};return e
}
func(v *VM) Init()error{if _,e:=v.invoke(0,0,0);e!=nil{return e};if _,e:=v.invoke(1,0,0);e!=nil{return e};return v.sync()}
func(v *VM) Memory()[]byte{if v.dirty||v.memory==nil{if e:=v.sync();e!=nil{panic(e)}};return v.memory}
func(v *VM) Globals()[]Global{
 out:=make([]Global,3)
 for i,index:=range []uint32{0,98,99}{n,e:=bridge(6,v.handle,index,0,0,nil);if e!=nil{panic(e)};out[i]=Global{v.R.Globals[i],n}}
 return out
}
func(v *VM) Image()Image{return Image{bytes.Clone(v.Memory()),v.Globals()}}
func(v *VM) Restore(im Image)error{
 if len(im.Memory)==0||len(im.Memory)>MaxMemory||len(im.Memory)%65536!=0||len(im.Globals)!=3{return ErrState}
 for i,g:=range im.Globals{if g.Name!=v.R.Globals[i]{return ErrState}}
 if _,e:=bridge(2,v.handle,uint32(len(im.Memory)),0,0,nil);e!=nil{return e}
 if _,e:=bridge(3,v.handle,0,0,0,im.Memory);e!=nil{return e}
 for i,index:=range []uint32{0,98,99}{if _,e:=bridge(7,v.handle,index,uint32(im.Globals[i].Value),0,nil);e!=nil{return e}}
 v.memory=bytes.Clone(im.Memory);v.dirty=false;return nil
}
func(v *VM) Begin(history string)(Progress,error){
 if len(history)==0||len(history)>8192{return Progress{},ErrState}
 p,e:=v.invoke(2,uint32(len(history)),0);if e!=nil||p==0||p>0xffffffff{return Progress{},ErrState}
 if _,e=bridge(3,v.handle,uint32(p),0,0,[]byte(history));e!=nil{return Progress{},e}
 pending,e:=v.invoke(4,uint32(p),uint32(len(history)));if e!=nil{return Progress{},e}
 if _,e=v.invoke(3,uint32(p),0);e!=nil{return Progress{},e}
 return v.progress(pending)
}
func(v *VM) Advance()(Progress,error){pending,e:=v.invoke(5,0,0);if e!=nil{return Progress{},e};return v.progress(pending)}
func(v *VM) progress(p uint64)(Progress,error){
 if p>1{return Progress{},ErrState};r:=Progress{Pending:p==1}
 get:=func(op uint32)uint64{n,e:=v.invoke(op,0,0);if e!=nil{panic(e)};return n}
 r.Step=uint32(get(8));r.Observed=get(6);r.Nodes=get(7);r.Depth=uint32(get(9))
 n,e:=bridge(5,v.handle,0,0,0,nil);if e!=nil||n==0||n>MaxMemory||n%65536!=0{return r,ErrState}
 if !r.Pending{at:=get(10);if at+8>n{return r,ErrState};b:=make([]byte,8);if _,e:=bridge(4,v.handle,uint32(at),0,0,b);e!=nil{return r,e};r.Move=string(bytes.SplitN(b,[]byte{0},2)[0]);if len(r.Move)<4||len(r.Move)>5||(r.Nodes<TargetNodes&&r.Depth!=245){return r,ErrState}}
 return r,nil
}
func(v *VM) Canonical()([]byte,error){
 p,e:=v.invoke(11,0,0);if e!=nil{return nil,e};n,e:=v.invoke(12,0,0);if e!=nil||n>MaxMemory||p>0xffffffff{return nil,ErrState}
 out:=make([]byte,n);if _,e=bridge(4,v.handle,uint32(p),0,0,out);e!=nil{return nil,e};return out,nil
}

// A domain-separated Merkle root binds every byte, memory length and globals.
// Internal trees let a small dirty set update the commitment without rehashing
// the complete engine memory on each slice.
type Tree struct {
	Leaves int
	Hashes [][32]byte
}

func leaf(i int, b []byte) [32]byte {
	h := sha256.New()
	h.Write([]byte("GL3_CHESS_VM_PAGE_V1"))
	var n [8]byte
	binary.LittleEndian.PutUint64(n[:], uint64(i))
	h.Write(n[:])
	h.Write(b)
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}
func parent(a, b [32]byte) [32]byte {
	var x [65]byte
	x[0] = 1
	copy(x[1:33], a[:])
	copy(x[33:], b[:])
	return sha256.Sum256(x[:])
}
func NewTree(memory []byte) *Tree {
	n := 1
	for n < (MaxMemory+PageSize-1)/PageSize {
		n *= 2
	}
	t := &Tree{n, make([][32]byte, n*2)}
	for i := 0; i < len(memory)/PageSize; i++ {
		t.Hashes[n+i] = leaf(i, memory[i*PageSize:(i+1)*PageSize])
	}
	for i := n - 1; i > 0; i-- {
		t.Hashes[i] = parent(t.Hashes[i*2], t.Hashes[i*2+1])
	}
	return t
}
func (t *Tree) Set(i int, b []byte) {
	at := t.Leaves + i
	t.Hashes[at] = leaf(i, b)
	for at /= 2; at > 0; at /= 2 {
		t.Hashes[at] = parent(t.Hashes[at*2], t.Hashes[at*2+1])
	}
}
func (t *Tree) SetLeaf(i int, b []byte) { t.Hashes[t.Leaves+i] = leaf(i, b) }

// Changed page indices arrive in ascending order. Merge shared ancestors once.
func (t *Tree) Flush(pages []int) {
	current := make([]int, len(pages))
	for i, p := range pages {
		current[i] = t.Leaves + p
	}
	for len(current) > 0 && current[0] > 1 {
		next := make([]int, 0, (len(current)+1)/2)
		last := -1
		for _, i := range current {
			p := i / 2
			if p == last {
				continue
			}
			last = p
			t.Hashes[p] = parent(t.Hashes[2*p], t.Hashes[2*p+1])
			next = append(next, p)
		}
		current = next
	}
}
func (t *Tree) Root(memoryBytes int, globals []Global) [32]byte {
	h := sha256.New()
	h.Write([]byte("GL3_CHESS_IMAGE_V1"))
	h.Write(ModuleSHA[:])
	h.Write(t.Hashes[1][:])
	var n [8]byte
	binary.LittleEndian.PutUint64(n[:], uint64(memoryBytes))
	h.Write(n[:])
	for _, g := range globals {
		h.Write([]byte(g.Name))
		h.Write([]byte{0})
		binary.LittleEndian.PutUint64(n[:], g.Value)
		h.Write(n[:])
	}
	var r [32]byte
	copy(r[:], h.Sum(nil))
	return r
}
func Diff(before, after []byte, fn func(int, []byte) error) error {
	if len(after) > MaxMemory || len(after)%PageSize != 0 || len(after) < len(before) {
		return ErrState
	}
	for at := 0; at < len(after); at += PageSize {
		page := after[at : at+PageSize]
		if at >= len(before) || !bytes.Equal(before[at:at+PageSize], page) {
			if e := fn(at/PageSize, page); e != nil {
				return e
			}
		}
	}
	return nil
}
func SortedGlobals(g []Global) bool {
	return sort.SliceIsSorted(g, func(i, j int) bool { return g[i].Name < g[j].Name })
}

// Read the export section instead of assuming a fixed global-index range.
func globalExports(b []byte) ([]string, error) {
	at := 8
	read := func(end int) (uint32, bool) {
		var n uint32
		for shift := uint(0); shift < 35; shift += 7 {
			if at >= end {
				return 0, false
			}
			x := b[at]
			at++
			n |= uint32(x&127) << shift
			if x < 128 {
				return n, true
			}
		}
		return 0, false
	}
	for at < len(b) {
		id := b[at]
		at++
		n, ok := read(len(b))
		if !ok || uint64(at)+uint64(n) > uint64(len(b)) {
			return nil, ErrState
		}
		end := at + int(n)
		if id != 7 {
			at = end
			continue
		}
		count, ok := read(end)
		if !ok {
			return nil, ErrState
		}
		var result []string
		for i := uint32(0); i < count; i++ {
			n, ok := read(end)
			if !ok || uint64(at)+uint64(n)+1 > uint64(end) {
				return nil, ErrState
			}
			name := string(b[at : at+int(n)])
			at += int(n)
			kind := b[at]
			at++
			if _, ok = read(end); !ok {
				return nil, ErrState
			}
			if kind == 3 && strings.HasPrefix(name, "gl3_global_") {
				result = append(result, name)
			}
		}
		if at != end || len(result) == 0 {
			return nil, ErrState
		}
		return result, nil
	}
	return nil, ErrState
}
