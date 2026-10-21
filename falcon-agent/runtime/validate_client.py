"""Loopback mocked-RPC tests of unsigned client funding limits. No public access."""
import argparse
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from eth_abi import decode, encode
from eth_utils import keccak

ROOT=Path(__file__).resolve().parent


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint',type=Path,required=True)
    args=parser.parse_args()
    golden=json.loads((ROOT/'prepaid-chat-validation.json').read_text())
    price=golden['simulated_gas_price_wei'];posting=golden['posting_fee_cap_wei']
    quote=(golden['maximum_units'],golden['maximum_billed_gas'],golden['upfront_escrow_wei'])
    state={'methods':[],'chain':4663,'code':'0x01'}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            item=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            method=item['method'];state['methods'].append(method)
            if method=='eth_chainId':result=hex(state['chain'])
            elif method=='eth_getCode':result=state['code']
            elif method=='eth_call':
                data=bytes.fromhex(item['params'][0]['data'][2:])
                assert data[:4]==keccak(text='quote(uint256,uint16,uint256,uint256)')[:4]
                assert decode(['uint256','uint16','uint256','uint256'],data[4:])==(11,2,price,posting)
                result='0x'+encode(['uint256']*3,quote).hex()
            else:raise AssertionError('Unexpected RPC method: '+method)
            body=json.dumps({'jsonrpc':'2.0','id':item['id'],'result':result}).encode()
            self.send_response(200);self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)

    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    env={**os.environ,'GH0ST_CLIENT_TEST_RPC':f'http://127.0.0.1:{server.server_port}',
         'NO_PROXY':'127.0.0.1','no_proxy':'127.0.0.1'}
    base=[sys.executable,str(ROOT/'client.py'),'--runtime','0x'+'11'*20,
          '--requester','0x'+'22'*20,'--rpc-url-env','GH0ST_CLIENT_TEST_RPC']
    caps=['--gas-price-cap-wei',str(price),'--posting-fee-cap-wei',str(posting)]
    checks=[]
    def run(arguments):
        return subprocess.run(base+arguments,env=env,capture_output=True,text=True,timeout=45)
    try:
        result=run(['quote','--prompt-tokens','11','--max-new-tokens','2']+caps)
        assert result.returncode==0,result.stderr
        assert int(json.loads(result.stdout)['contract_quote']['budget_wei'])==quote[2]
        checks.append('Client reads and displays the contract quote without signing or sending')
        start=['start','--checkpoint',str(args.checkpoint),'--prompt','Hi','--max-new-tokens','2',
               '--executor','0x'+'33'*20]+caps
        result=run(start+['--max-budget-wei',str(quote[2]-1)])
        assert result.returncode!=0 and 'exceeds explicit maximum wallet budget' in result.stderr
        checks.append('Explicit wallet budget rejects a larger contract-computed deposit')
        result=run(start+['--max-budget-wei',str(quote[2])])
        assert result.returncode==0,result.stderr
        output=json.loads(result.stdout);transaction=output['transaction']
        assert int(transaction['value'],16)==quote[2]
        data=bytes.fromhex(transaction['data'][2:])
        values=decode(['uint32[]','uint16','address','uint256','uint256','uint256'],data[4:])
        assert list(values[0])==golden['prompt_tokens'] and values[1]==2
        assert values[3:]==(price,posting,quote[2])
        checks.append('Unsigned start uses official chat tokens, exact quoted value and bound fee caps')
        state['chain']=1
        result=run(['quote','--prompt-tokens','11']+caps)
        assert result.returncode!=0 and 'Wrong chain' in result.stderr
        checks.append('Wrong chain is rejected before preparing a deposit')
        state['chain']=4663;state['code']='0x'
        result=run(['quote','--prompt-tokens','11']+caps)
        assert result.returncode!=0 and 'Runtime not deployed' in result.stderr
        checks.append('Missing deployed runtime is rejected before preparing a deposit')
        count=len(state['methods'])
        for command in [['advance','--session','3'],['cancel','--session','3'],
                        ['withdraw','--recipient','0x'+'22'*20],
                        ['set-executor','--session','3','--executor','0x'+'33'*20]]:
            result=run(command);assert result.returncode==0,result.stderr
            assert json.loads(result.stdout)['transaction']['value']=='0x0'
        assert len(state['methods'])==count
        assert set(state['methods'])=={'eth_chainId','eth_getCode','eth_call'}
        checks.append('Continuation, cancel, executor replacement and withdrawal are unsigned only; no sending RPC exists')
    finally:server.shutdown();server.server_close()
    report={'status':'passed','scope':'Loopback mocked read-only RPC; client wallet spending controls',
            'checks':checks,'public_rpc_calls':0,'public_transactions_sent':0,'rpc_methods':sorted(set(state['methods']))}
    (ROOT/'client-validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))


if __name__=='__main__':main()
