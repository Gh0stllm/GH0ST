"""Loopback-only EVM harness. No keys or public RPC are accepted."""
import subprocess
import time
import requests
from eth_abi import encode, decode
from eth_utils import keccak


def initcode(payload):
    runtime = b'\0'+payload
    assert len(runtime) <= 98304
    width = 2 if len(runtime) < 65536 else 3
    prefix = bytes([0x5f+width])+len(runtime).to_bytes(width, 'big')+bytes([0x80,0x60,10+width,0x60,0,0x39,0x60,0,0xf3])
    return prefix+runtime


def creation_gas(payload):
    init = initcode(payload)
    n = len(payload)+1
    words = (n+31)//32
    return 53000+16*len(init)-12*init.count(0)+2*((len(init)+31)//32)+18+6*words+words*words//512+200*n


def index_blob(data, addresses, payload):
    import hashlib
    return b'G4IX'+payload.to_bytes(4,'big')+len(data).to_bytes(8,'big')+hashlib.sha256(data).digest()+b''.join(bytes.fromhex(a[2:]) for a in addresses)


class EVM:
    def __init__(self, anvil, port=18587):
        self.child=subprocess.Popen([str(anvil),'--host','127.0.0.1','--port',str(port),'--chain-id','31337',
            '--hardfork','cancun','--code-size-limit','98304','--gas-limit','32000000',
            '--base-fee','0','--gas-price','0','--silent'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        self.url=f'http://127.0.0.1:{port}'
        self.session=requests.Session();self.session.trust_env=False
        for _ in range(200):
            try:
                assert int(self.rpc('eth_chainId'),16)==31337
                self.account=self.rpc('eth_accounts')[0]
                break
            except requests.ConnectionError:time.sleep(.05)
        else:raise RuntimeError('Local EVM startup failed')
    def rpc(self, method, params=()):
        r=self.session.post(self.url,json={'jsonrpc':'2.0','id':1,'method':method,'params':list(params)},timeout=60).json()
        if 'error' in r:raise RuntimeError(r['error'])
        return r['result']
    def tx(self, payload):
        h=self.rpc('eth_sendTransaction',[{'from':self.account,'gas':hex(31000000),**payload}])
        for _ in range(200):
            r=self.rpc('eth_getTransactionReceipt',[h])
            if r is not None:break
            time.sleep(.01)
        assert r and int(r['status'],16)==1,r
        return r
    def deploy(self, bytecode):
        r=self.tx({'data':'0x'+bytecode.hex()})
        return r['contractAddress'],int(r['gasUsed'],16)
    def data(self, payload):
        address, gas=self.deploy(initcode(payload))
        assert self.rpc('eth_getCode',[address,'latest'])=='0x00'+payload.hex()
        assert gas==creation_gas(payload),(gas,creation_gas(payload))
        return address,gas
    def payload(self, target, signature, types, args):
        return {'to':target,'data':'0x'+(keccak(text=signature)[:4]+encode(types,args)).hex()}
    def call(self, payload):
        result=self.rpc('eth_call',[payload,'latest'])
        values=list(decode(['int256[]'],bytes.fromhex(result[2:]))[0])
        receipt=self.tx(payload)
        return values,int(receipt['gasUsed'],16)
    def dot(self, target, shard, x, rows, cols):
        return self.call(self.payload(target,'dot(address,bytes,uint256,uint256)',
            ['address','bytes','uint256','uint256'],[shard,x.astype('>i2').tobytes(),rows,cols]))
    def file(self, target, index, offset, x, first, rows, cols):
        return self.call(self.payload(target,'dotFile(address,uint256,bytes,uint256,uint256,uint256)',
            ['address','uint256','bytes','uint256','uint256','uint256'],[index,offset,x.astype('>i2').tobytes(),first,rows,cols]))
    def close(self):
        self.child.terminate()
        self.child.wait(timeout=5)
