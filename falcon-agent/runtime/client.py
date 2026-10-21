"""Read-only contract quotes and unsigned prepaid wallet calls; never signs or sends."""
import argparse
import json
import os
from pathlib import Path
import requests
from eth_abi import encode, decode
from eth_utils import keccak, to_checksum_address


def payload(signature, types, values):
    return '0x'+(keccak(text=signature)[:4]+encode(types, values)).hex()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--runtime', required=True)
    p.add_argument('--requester', required=True, help='Wallet that will submit this call (executor for advance)')
    p.add_argument('--rpc-url-env', default='GH0ST_RH_RPC_URL')
    sub=p.add_subparsers(dest='command', required=True)
    for name in ['quote','start']:
        parser=sub.add_parser(name)
        parser.add_argument('--max-new-tokens', type=int, default=2)
        parser.add_argument('--gas-price-cap-wei', type=int, required=True)
        parser.add_argument('--posting-fee-cap-wei', type=int, required=True)
        if name=='quote':
            parser.add_argument('--prompt-tokens',type=int,required=True)
        else:
            parser.add_argument('--checkpoint',type=Path,required=True)
            parser.add_argument('--prompt',required=True)
            parser.add_argument('--executor',required=True)
            parser.add_argument('--max-budget-wei',type=int,required=True,
                                help='Explicit wallet spending limit; reject contract quotes above it')
    advance=sub.add_parser('advance')
    advance.add_argument('--session',type=int,required=True)
    advance.add_argument('--units',type=int,default=256)
    cancel=sub.add_parser('cancel');cancel.add_argument('--session',type=int,required=True)
    change=sub.add_parser('set-executor');change.add_argument('--session',type=int,required=True)
    change.add_argument('--executor',required=True)
    withdraw=sub.add_parser('withdraw');withdraw.add_argument('--recipient',required=True)
    args=p.parse_args()
    runtime=to_checksum_address(args.runtime);caller=to_checksum_address(args.requester)
    extra={};value=0
    if args.command in ['start','quote']:
        tokens=None
        if args.command=='start':
            from transformers import AutoTokenizer
            tok=AutoTokenizer.from_pretrained(args.checkpoint,local_files_only=True,trust_remote_code=False)
            tokens=tok.apply_chat_template([{'role':'user','content':args.prompt}],tokenize=True,
                                          add_generation_prompt=True,return_dict=True)['input_ids']
            prompt_tokens=len(tokens)
        else:prompt_tokens=args.prompt_tokens
        if not (prompt_tokens>0 and 0<args.max_new_tokens and prompt_tokens+args.max_new_tokens<=64):
            p.error('64-token context exceeded or empty input')
        url=os.environ[args.rpc_url_env]
        def rpc(method,params):
            r=requests.post(url,json={'jsonrpc':'2.0','id':1,'method':method,'params':params},timeout=60)
            r.raise_for_status();result=r.json()
            if 'error' in result:raise RuntimeError(str(result['error']))
            return result['result']
        if int(rpc('eth_chainId',[]),16)!=4663:raise RuntimeError('Wrong chain')
        if rpc('eth_getCode',[runtime,'latest']) in ['0x','0x0']:raise RuntimeError('Runtime not deployed')
        quote_data=payload('quote(uint256,uint16,uint256,uint256)',
            ['uint256','uint16','uint256','uint256'],
            [prompt_tokens,args.max_new_tokens,args.gas_price_cap_wei,args.posting_fee_cap_wei])
        raw=rpc('eth_call',[{'from':caller,'to':runtime,'data':quote_data},'latest'])
        units,gas_cap,budget=decode(['uint256','uint256','uint256'],bytes.fromhex(raw[2:]))
        extra={'contract_quote':{'maximum_units':units,'maximum_billed_execution_gas':gas_cap,
            'budget_wei':str(budget),'gas_price_cap_wei':args.gas_price_cap_wei,
            'posting_fee_cap_per_call_wei':str(args.posting_fee_cap_wei)},
            'quote_kind':'Conservative refundable maximum, not exact predicted network cost',
            'excluded_wallet_fees':'Funding/start, cancel, executor change and withdrawal transactions'}
        if args.command=='quote':
            print(json.dumps(extra,indent=2));return
        if budget>args.max_budget_wei:raise RuntimeError('Contract quote exceeds explicit maximum wallet budget')
        value=budget
        signature='startPrepaid(uint32[],uint16,address,uint256,uint256,uint256)'
        types=['uint32[]','uint16','address','uint256','uint256','uint256']
        values=[tokens,args.max_new_tokens,to_checksum_address(args.executor),args.gas_price_cap_wei,
                args.posting_fee_cap_wei,budget]
        extra.update(prompt_token_ids=tokens,prompt_tokens=prompt_tokens)
    elif args.command=='advance':
        if args.session<0 or not 1<=args.units<=256:p.error('Invalid session/units')
        signature='advancePrepaid(uint256,uint256)';types=['uint256','uint256'];values=[args.session,args.units]
    elif args.command=='cancel':
        signature='cancel(uint256)';types=['uint256'];values=[args.session]
    elif args.command=='set-executor':
        signature='setExecutor(uint256,address)';types=['uint256','address']
        values=[args.session,to_checksum_address(args.executor)]
    else:
        signature='withdraw(address)';types=['address'];values=[to_checksum_address(args.recipient)]
    print(json.dumps({'chain_id':4663,'transaction':{'from':caller,'to':runtime,'value':hex(value),
        'data':payload(signature,types,values)},**extra,
        'note':'Unsigned only. Executor submits and initially funds continuations, earning capped escrow credit. Refunds and earnings require withdrawal. No automatic execution.'},indent=2))


if __name__=='__main__':main()
