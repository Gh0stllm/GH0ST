// Offline study only: read frozen preimages, restore bytes, compare lossless encodings.
// No VM instantiation, engine call, block production, database write or pruning.
package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"runtime"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethdb"
	"github.com/ethereum/go-ethereum/rlp"
	"github.com/ethereum/go-ethereum/triedb"
	"github.com/offchainlabs/nitro/arbos/burn"
	"github.com/offchainlabs/nitro/arbos/storage"
)

type entry struct { Offset int64; Size uint32 }
type frozenDB struct { ethdb.KeyValueStore; file *os.File; index map[common.Hash]entry; reads uint64 }
func (d *frozenDB) Get(key []byte) ([]byte,error) {
	if bytes.HasPrefix(key,rawdb.CodePrefix) && len(key)==len(rawdb.CodePrefix)+32 { key=key[len(rawdb.CodePrefix):] }
	if len(key)!=32 { return nil,fmt.Errorf("non-preimage lookup %x",key) }
	e,ok:=d.index[common.BytesToHash(key)];if !ok{return nil,errors.New("frozen preimage absent")}
	b:=make([]byte,e.Size);_,err:=d.file.ReadAt(b,e.Offset);d.reads++;return b,err
}
func(d *frozenDB) Has(key []byte)(bool,error){_,e:=d.Get(key);return e==nil,nil}
func(d *frozenDB) Put([]byte,[]byte)error{return errors.New("study is read only")}
func(d *frozenDB) Delete([]byte)error{return errors.New("study is read only")}
func(d *frozenDB) Close()error{return nil}

type global struct { Name string; Value uint64 }
type meta struct { Version uint32; Module [32]byte; Root [32]byte; MemoryBytes uint32; Globals []global; Generation uint64; Head [32]byte; Deltas uint32; History,Request string; Progress json.RawMessage }
type counter struct { N uint64 }
func(c *counter)Write(b []byte)(int,error){c.N+=uint64(len(b));return len(b),nil}
func must(err error){if err!=nil{panic(err)}}
func check(ok bool,msg string){if !ok{panic(msg)}}
func hash(b []byte)string{x:=sha256.Sum256(b);return hex.EncodeToString(x[:])}

func namespace(owner common.Address,job [32]byte)[]byte{return crypto.Keccak256([]byte("GL3_CHESS_SLICE_JOB_V1"),owner[:],job[:])}
func pageAddress(ns []byte,i int)common.Address{var n[8]byte;binary.BigEndian.PutUint64(n[:],uint64(i));return common.BytesToAddress(crypto.Keccak256([]byte("GL3_CHESS_SLICE_CELL_V1"),ns,n[:])[12:])}
func deltaAddress(h[32]byte,i int)common.Address{var n[4]byte;binary.LittleEndian.PutUint32(n[:],uint32(i));return common.BytesToAddress(crypto.Keccak256([]byte("GL3_CHESS_IMMUTABLE_DELTA_V1"),h[:],n[:])[12:])}
func metadata(db *state.StateDB,ns []byte)meta{
	s:=storage.NewGeth(db,burn.NewSystemBurner(nil,false)).OpenSubStorage([]byte("GL3_CHESS_SLICE_META_V1")).OpenSubStorage(ns)
	b,e:=s.GetBytes();must(e);var m meta;must(json.Unmarshal(b,&m));check(m.Version==2,"metadata version");return m
}

// Exact existing Tree.NewTree/Root commitment, independently reproduced for byte checks.
func imageRoot(memory []byte,globals []global,module[32]byte)[32]byte{
	n:=1;for n<(768*1024*1024+4095)/4096{n*=2};tree:=make([][32]byte,n*2)
	for i:=0;i<len(memory)/4096;i++{h:=sha256.New();h.Write([]byte("GL3_CHESS_VM_PAGE_V1"));var b[8]byte;binary.LittleEndian.PutUint64(b[:],uint64(i));h.Write(b[:]);h.Write(memory[i*4096:(i+1)*4096]);copy(tree[n+i][:],h.Sum(nil))}
	for i:=n-1;i>0;i--{var b[65]byte;b[0]=1;copy(b[1:33],tree[2*i][:]);copy(b[33:],tree[2*i+1][:]);tree[i]=sha256.Sum256(b[:])}
	h:=sha256.New();h.Write([]byte("GL3_CHESS_IMAGE_V1"));h.Write(module[:]);h.Write(tree[1][:]);var b[8]byte;binary.LittleEndian.PutUint64(b[:],uint64(len(memory)));h.Write(b[:]);for _,g:=range globals{h.Write([]byte(g.Name));h.Write([]byte{0});binary.LittleEndian.PutUint64(b[:],g.Value);h.Write(b[:])};var result[32]byte;copy(result[:],h.Sum(nil));return result
}

func main(){
	started:=time.Now();runtime.GOMAXPROCS(2)
	if len(os.Args)!=2{panic("output report path required")};reportPath:=os.Args[1]
	f,e:=os.Open("/root/bounded-restore/preimages.bin");must(e);defer f.Close()
	d:=&frozenDB{file:f,index:make(map[common.Hash]entry,410000)};var pos int64;var records int;sha:=sha256.New()
	for {var n[8]byte;_,err:=io.ReadFull(f,n[:]);if err==io.EOF{break};must(err);sha.Write(n[:]);size:=binary.LittleEndian.Uint64(n[:]);check(size>0&&size<=64*1024*1024,"preimage length");b:=make([]byte,int(size));_,err=io.ReadFull(f,b);must(err);sha.Write(b);d.index[crypto.Keccak256Hash(b)]=entry{pos+8,uint32(size)};pos+=8+int64(size);records++}
	headerBytes,e:=d.Get(common.HexToHash("0x4b0cb7e808fd0e32ea667114adf94e67fd7c6617a545e7fb473aab0afb4eb0f0").Bytes());must(e);var header types.Header;must(rlp.DecodeBytes(headerBytes,&header))
	raw:=rawdb.NewDatabase(d);db,e:=state.NewDeterministic(header.Root,state.NewDatabase(triedb.NewDatabase(raw,nil),nil));must(e)
	owner:=common.HexToAddress("0x26E554a8acF9003b83495c7f45F06edCB803d4e3");var job[32]byte;job[0]=0x33
	seedNS:=crypto.Keccak256([]byte("GL3_CHESS_SLICE_SEED_V1"));seed:=metadata(db,seedNS);m:=metadata(db,namespace(owner,job));check(m.MemoryBytes>=seed.MemoryBytes&&m.MemoryBytes%65536==0,"memory lengths")
	base:=make([]byte,m.MemoryBytes);seedAccounts:=0
	for i:=0;i<int(seed.MemoryBytes)/4096;i++{code:=db.GetCodeUncached(pageAddress(seedNS,i));if len(code)==0{continue};check(bytes.HasPrefix(code,[]byte{0,'G','L','3','S',1})&&(len(code)==6||len(code)==4102),"seed page encoding");copy(base[i*4096:],code[6:]);seedAccounts++}
	check(imageRoot(base[:seed.MemoryBytes],seed.Globals,seed.Module)==seed.Root,"genesis image commitment mismatch")
	memory:=bytes.Clone(base);seen:=make([]byte,(len(memory)/32+7)/8);head:=m.Head;var rawDeltas,codeBytes uint64;var deltaAccounts,nonzeroNonces,nonzeroBalances int
	for left:=m.Deltas;left>0;left--{
		first:=db.GetCodeUncached(deltaAddress(head,0));check(len(first)>=10&&bytes.Equal(first[:6],[]byte{0,'G','L','3','D',1}),"delta first chunk")
		n:=int(binary.LittleEndian.Uint32(first[6:10]));check(n>=44&&n<=32*1024*1024,"delta size");body:=make([]byte,n)
		for at:=0;at<n;at+=16384{end:=at+16384;if end>n{end=n};a:=deltaAddress(head,at/16384);code:=first;if at>0{code=db.GetCodeUncached(a)};check(len(code)==10+end-at&&bytes.Equal(code[:6],first[:6])&&int(binary.LittleEndian.Uint32(code[6:10]))==n,"delta chunk");copy(body[at:end],code[10:]);deltaAccounts++;codeBytes+=uint64(len(code));if db.GetNonce(a)!=0{nonzeroNonces++};if !db.GetBalance(a).IsZero(){nonzeroBalances++}}
		check(sha256.Sum256(body)==head&&string(body[:4])=="GSD1","delta digest");size:=int(binary.LittleEndian.Uint32(body[36:40]));count:=int(binary.LittleEndian.Uint32(body[40:44]));check(size<=len(memory)&&size%65536==0&&44+36*count==len(body),"delta header");priorOffset:=-1
		for at:=44;at<len(body);at+=36{offset:=int(binary.LittleEndian.Uint32(body[at:at+4]));check(offset%32==0&&offset>priorOffset&&offset+32<=size,"delta word order");priorOffset=offset;word:=offset/32;mask:=byte(1<<uint(word%8));if seen[word/8]&mask==0{copy(memory[offset:offset+32],body[at+4:at+36]);seen[word/8]|=mask}}
		copy(head[:],body[4:36]);rawDeltas+=uint64(n)
	}
	check(head==([32]byte{}),"delta ancestry not exhausted");must(db.Error());gotRoot:=imageRoot(memory,m.Globals,m.Module);check(gotRoot==m.Root,"authoritative preterminal image root mismatch")
	// Four lossless encodings against the fixed genesis, with no predecessor chain.
	bitmap:=make([]byte,(len(memory)/32+7)/8);changedWords,changedPages,runCount:=0,0,0;inRun:=false
	for at:=0;at<len(memory);at+=32{if bytes.Equal(base[at:at+32],memory[at:at+32]){inRun=false;continue};word:=at/32;changedWords++;bitmap[word/8]|=1<<uint(word%8);if !inRun{runCount++;inRun=true}}
	for at:=0;at<len(memory);at+=4096{if !bytes.Equal(base[at:at+4096],memory[at:at+4096]){changedPages++}}
	formats:=map[string]func(io.Writer){
		"word_records":func(w io.Writer){for at:=0;at<len(memory);at+=32{if !bytes.Equal(base[at:at+32],memory[at:at+32]){must(binary.Write(w,binary.LittleEndian,uint32(at/32)));_,e=w.Write(memory[at:at+32]);must(e)}}},
		"word_bitmap":func(w io.Writer){_,e=w.Write(bitmap);must(e);for word:=0;word<len(memory)/32;word++{if bitmap[word/8]&(1<<uint(word%8))!=0{_,e=w.Write(memory[word*32:(word+1)*32]);must(e)}}},
		"word_runs":func(w io.Writer){for word:=0;word<len(memory)/32;{if bitmap[word/8]&(1<<uint(word%8))==0{word++;continue};start:=word;for word<len(memory)/32&&bitmap[word/8]&(1<<uint(word%8))!=0{word++};must(binary.Write(w,binary.LittleEndian,uint32(start)));must(binary.Write(w,binary.LittleEndian,uint32(word-start)));_,e=w.Write(memory[start*32:word*32]);must(e)}},
		"changed_pages":func(w io.Writer){for at:=0;at<len(memory);at+=4096{if !bytes.Equal(base[at:at+4096],memory[at:at+4096]){must(binary.Write(w,binary.LittleEndian,uint32(at/4096)));_,e=w.Write(memory[at:at+4096]);must(e)}}},
		"full_image":func(w io.Writer){_,e=w.Write(memory);must(e)},
	}
	// An actual private bitmap file is decoded with bounded buffers, without a third image.
	checkpointPath:=reportPath+".bitmap.bin";checkpoint,e:=os.OpenFile(checkpointPath,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600);must(e);bw:=bufio.NewWriterSize(checkpoint,65536);formats["word_bitmap"](bw);must(bw.Flush());must(checkpoint.Close())
	checkpoint,e=os.Open(checkpointPath);must(e);reader:=bufio.NewReaderSize(checkpoint,65536);readBitmap:=make([]byte,len(bitmap));_,e=io.ReadFull(reader,readBitmap);must(e);check(bytes.Equal(readBitmap,bitmap),"bitmap identity");roundtripHash:=sha256.New();var wordBytes[32]byte
	for word:=0;word<len(memory)/32;word++{expected:=base[word*32:(word+1)*32];if readBitmap[word/8]&(1<<uint(word%8))!=0{_,e=io.ReadFull(reader,wordBytes[:]);must(e);expected=wordBytes[:]};check(bytes.Equal(expected,memory[word*32:(word+1)*32]),"bitmap decoded word");roundtripHash.Write(expected)};var extra[1]byte;_,e=reader.Read(extra[:]);check(e==io.EOF,"bitmap trailing data");must(checkpoint.Close());check(hex.EncodeToString(roundtripHash.Sum(nil))==hash(memory),"bitmap all-byte hash")
	globalsJSON,e:=json.Marshal(m.Globals);must(e);headerSize:=8+32+32+32+4+4+len(globalsJSON)+4 // illustrative versioned descriptor
	measurements:=map[string]any{}
	for name,encode:=range formats{rawCount,compressed:=&counter{},&counter{};z,err:=gzip.NewWriterLevel(compressed,gzip.BestSpeed);must(err);w:=bufio.NewWriterSize(io.MultiWriter(rawCount,z),65536);encode(w);must(w.Flush());must(z.Close());rawBytes:=int(rawCount.N);chunks:=(rawBytes+headerSize+16383)/16384;measurements[name]=map[string]any{"bodyBytes":rawBytes,"illustrativeDescriptorBytes":headerSize,"bytesWithDescriptor":rawBytes+headerSize,"hypothetical16KiBCodeAccounts":chunks,"hypotheticalCodeBytesAt10BytePrefix":rawBytes+headerSize+10*chunks,"gzipLevel1BodyBytes":compressed.N,"gzipOverBodyRatio":float64(compressed.N)/float64(rawBytes)}}
	result:=map[string]any{"passed":true,"allExecutionOnRunpod":true,"engineExecuted":false,"blockProduced":false,"chainOrFrozenInputsModified":false,"prunerExecuted":false,"scope":"Authenticated PRETERMINAL first-decision image only; final computing transaction not executed; not a completed-decision checkpoint acceptance","preimagesFileBytes":pos,"preimagesFileSHA256":hex.EncodeToString(sha.Sum(nil)),"preimageRecords":records,"prestateBlockNumber":header.Number.Uint64(),"prestateBlockHash":header.Hash(),"prestateStateRoot":header.Root,"deltaCount":m.Deltas,"rawDeltaBodyBytes":rawDeltas,"deltaCodeAccounts":deltaAccounts,"deltaCodeBytes":codeBytes,"observedDeltaNonzeroNonces":nonzeroNonces,"observedDeltaNonzeroBalances":nonzeroBalances,"genesisMemoryBytes":seed.MemoryBytes,"currentMemoryBytes":m.MemoryBytes,"genesisCodeAccounts":seedAccounts,"genesisImageRoot":hex.EncodeToString(seed.Root[:]),"authoritativeImageRoot":hex.EncodeToString(m.Root[:]),"restoredImageSHA256":hash(memory),"globals":m.Globals,"changedWordsFromGenesis":changedWords,"changedPagesFromGenesis":changedPages,"contiguousWordRuns":runCount,"allImageBytesBitmapRoundTripMatch":true,"allGlobalsRetained":true,"formats":measurements,"lookupReads":d.reads,"seconds":time.Since(started).Seconds(),"qualityOrSearchPolicyChanged":false,"twentyGamesCapacityAccepted":false}
	out,e:=json.MarshalIndent(result,"","  ");must(e);must(os.WriteFile(reportPath,append(out,'\n'),0600));fmt.Println(string(out))
}
