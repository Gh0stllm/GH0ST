"""Fail-closed GL3 operator bootstrap; --check is read-only and never starts Nitro."""
from pathlib import Path
import argparse,copy,hashlib,ipaddress,json,os,re,stat,tempfile,urllib.parse
from operator_runtime import Supervisor,SupervisionError,private_dir

NODE=Path('/workspace/gl3/durable/bin/nitro')
MACHINES=Path('/workspace/gl3/durable/machines')
NODE_SHA='d9e778d3c513e106dab9de8ef04be9500093b0638cfd463e4d4ec542c214c4ed'
ROOT='0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97'
FILES={'module-root.txt':'31ea9746e168fe49059a1bf7a49509a2827d48a07444cc97618d1b0c01351306','replay.wasm':'9d6d28c4810cfc220b5fdbc4a7a675ee333dc86a5e998a6380c1c62a59b260af','machine.v2.wavm.br':'791073b628dee37ed5faccb43841dc317dc24e21bd0bb0b7d38c08e652cd78a5'}
ALIASES={'/root/gl3-base-launch/bin':'/workspace/gl3/durable/bin','/root/gl3-base-launch/machines':'/workspace/gl3/durable/machines','/root/gl3-base-launch/artifact-lock.json':'/workspace/gl3/durable/artifact-lock.json','/root/gl3-base-launch/nitro-clean':'/workspace/gl3/durable/nitro-clean','/root/dispute':'/workspace/gl3/durable/neutral/dispute','/root/terminal-acceptance/bin/geth':'/workspace/gl3/durable/bin/geth'}
PROFILE_SCHEMA='gh0st.gl3.base.operator-profile.v1'
REVIEW_SCHEMA='gh0st.gl3.base.activation-review.v1'
class GateError(Exception):pass

def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
def load(path):
    try:return json.loads(Path(path).read_text())
    except Exception:raise GateError('json_unavailable_or_invalid') from None

def persistent(path):
    try:return Path(path).is_absolute() and Path(path).resolve().is_relative_to('/workspace/gl3')
    except Exception:return False

def secure_metadata(path,*,directory=False,private=False):
    p=Path(path)
    if not p.is_absolute() or p.is_symlink():raise GateError('reference_path_or_symlink_refused')
    try:s=p.stat()
    except OSError:raise GateError('referenced_path_missing') from None
    if (directory and not stat.S_ISDIR(s.st_mode)) or (not directory and not stat.S_ISREG(s.st_mode)):
        raise GateError('reference_type_refused')
    if s.st_uid!=os.getuid() or s.st_mode&(0o077 if private else 0o022):raise GateError('reference_permissions_refused')
    return s

def artifact_checks():
    errors=[]
    try:
        if Path('/workspace').stat().st_dev==Path('/').stat().st_dev:errors.append('persistent_mount_missing_or_ephemeral')
        if digest(NODE)!=NODE_SHA:errors.append('official_node_hash_mismatch')
        for name,h in FILES.items():
            if digest(MACHINES/ROOT/name)!=h:errors.append('official_machine_file_hash_mismatch:'+name)
        if (MACHINES/ROOT/'module-root.txt').read_text().strip()!=ROOT:errors.append('official_module_root_mismatch')
    except Exception:errors.append('official_artifact_unavailable')
    return errors

def alias_plan():
    plan=[]
    for alias,target in ALIASES.items():
        a=Path(alias);t=Path(target)
        if not t.exists():raise GateError('alias_target_unavailable')
        if a.is_symlink():
            if a.resolve()!=t.resolve():raise GateError('existing_alias_conflict_refused')
            plan.append({'alias':alias,'target':target,'action':'already_matches'})
        elif a.exists():raise GateError('existing_non_alias_refused')
        else:plan.append({'alias':alias,'target':target,'action':'create_only'})
    return plan

def install_aliases():
    if artifact_checks():raise GateError('artifact_verification_failed')
    plan=alias_plan() # Validate every entry before any mutation.
    for item in plan:
        if item['action']!='create_only':continue
        alias=Path(item['alias']);alias.parent.mkdir(parents=True,exist_ok=True)
        # symlink() fails on a concurrent create; never replaces an existing path.
        alias.symlink_to(item['target'],target_is_directory=Path(item['target']).is_dir())
    return plan

def ref_metadata(ref,*,key=False):
    if not isinstance(ref,dict):raise GateError('secret_reference_invalid')
    if key:
        path=ref.get('path','');p=Path(path)
        if not p.is_absolute() or not (p.is_relative_to('/workspace/gl3/mainnet/secrets') or p.is_relative_to('/run/secrets/gl3')):
            raise GateError('role_key_path_not_private_prefix')
        if ref.get('format')=='keystore':
            secure_metadata(p,directory=True,private=True)
            children=list(p.iterdir())
            if not children or len(children)>1024:raise GateError('keystore_inventory_invalid')
            for child in children:secure_metadata(child,private=True) # metadata only, never key contents
        elif ref.get('format')=='config-secret-reference':secure_metadata(p,private=True)
        else:raise GateError('role_key_reference_format_invalid')
        name=ref.get('passwordEnv','')
        if not re.fullmatch(r'GL3_[A-Z0-9_]+',name):raise GateError('wallet_password_env_reference_missing')
        if name not in os.environ:raise GateError('wallet_password_env_not_present')
    else:
        if ref.get('selected') is not True or ref.get('templatePlaceholder')!='$GL3_PARENT_RPC':raise GateError('parent_rpc_reference_not_selected')
        if ref.get('source')=='env':
            name=ref.get('name','')
            if not re.fullmatch(r'GL3_[A-Z0-9_]+',name) or name not in os.environ:raise GateError('parent_rpc_env_not_present')
        elif ref.get('source')=='file':
            p=Path(ref.get('path',''))
            if not (p.is_absolute() and (p.is_relative_to('/workspace/gl3/mainnet/secrets') or p.is_relative_to('/run/secrets/gl3'))):raise GateError('parent_rpc_file_path_refused')
            secure_metadata(p,private=True)
        else:raise GateError('parent_rpc_reference_source_invalid')

def config_checks(profile,cfg):
    e=[];chain=profile['chain'];nc=profile['nodeConfig'];storage=profile['storage']
    def need(condition,code):
        if not condition:e.append(code)
    need(cfg.get('chain',{}).get('id')==chain['childChainIdProposal'],'config_child_chain_mismatch')
    need(cfg.get('chain',{}).get('info-files')==[nc['chainInfoPath']],'config_chain_info_mismatch')
    need(cfg.get('parent-chain',{}).get('id')==4663,'config_parent_chain_mismatch')
    need(cfg.get('parent-chain',{}).get('connection',{}).get('url')=='$GL3_PARENT_RPC','inline_or_missing_parent_rpc_refused')
    p=cfg.get('persistent',{});need(p.get('chain')==storage['chainPath'] and p.get('global-config')==storage['globalConfigPath'],'config_storage_paths_mismatch')
    need(p.get('db-engine')=='pebble' and p.get('pebble',{}).get('sync-mode') is True,'config_sync_db_required')
    init=cfg.get('init',{});need(init.get('genesis-json-file')==nc['genesisPath'] and init.get('validate-genesis-assertion') is True,'config_strict_genesis_required')
    need(set(init)<= {'genesis-json-file','validate-genesis-assertion','accounts-per-sync'},'config_init_override_refused')
    need(cfg.get('ensure-rollup-deployment') is True,'config_real_rollup_check_required')
    need(cfg.get('validation',{}).get('wasm',{}).get('root-path')==str(MACHINES),'config_machines_path_mismatch')
    for section in ['http','ws','auth']:
        address=cfg.get(section,{}).get('addr','')
        try:ok=address in ('','localhost') or ipaddress.ip_address(address).is_loopback
        except ValueError:ok=False
        need(ok,'non_loopback_bind_refused:'+section)
    node=cfg.get('node',{});execution=cfg.get('execution',{})
    need(node.get('feed',{}).get('output',{}).get('enable',False) is False,'public_feed_output_refused')
    need(node.get('dangerous',{}).get('no-l1-listener',False) is False,'parent_listener_bypass_refused')
    for section in ['metrics-server','pprof-cfg']:
        address=cfg.get(section,{}).get('addr','127.0.0.1')
        try:ok=address in ('','localhost') or ipaddress.ip_address(address).is_loopback
        except ValueError:ok=False
        need(ok,'non_loopback_bind_refused:'+section)
    def walk(x):
        if isinstance(x,dict):
            for key,value in x.items():
                if key in ['private-key','privateKey'] and value not in ('',None):e.append('inline_private_key_refused')
                if key=='password' and value not in ('',None,'$GL3_WALLET_PASSWORD'):e.append('inline_password_refused')
                if key=='only-create-key' and value is not False:e.append('wallet_creation_refused')
                walk(value)
        elif isinstance(x,list):
            for y in x:walk(y)
    walk(cfg)
    paid=[]
    for role,section in [('batch-poster','batch-poster'),('validator','staker')]:
        if node.get(section,{}).get('enable',False):paid.append(role)
    if profile['roles']['mode']=='observer':
        need(not paid and node.get('sequencer',False) is False and execution.get('sequencer',{}).get('enable',False) is False,'observer_must_disable_active_roles')
    refs=profile['roles'].get('secretReferences',[])
    if not isinstance(refs,list):e.append('role_references_invalid');refs=[]
    for role in paid:
        matches=[x for x in refs if isinstance(x,dict) and x.get('role')==role]
        if len(matches)!=1:e.append('paid_role_key_reference_missing:'+role);continue
        wallet=node.get('batch-poster' if role=='batch-poster' else 'staker',{}).get('parent-chain-wallet',{})
        need(wallet.get('pathname')==matches[0].get('path') and wallet.get('password')=='$GL3_WALLET_PASSWORD','paid_role_wallet_reference_mismatch:'+role)
        account=wallet.get('account','');authority=profile.get('authority',{}).get('batchPosters' if role=='batch-poster' else 'validators',[])
        need(isinstance(account,str) and bool(re.fullmatch('0x[0-9a-fA-F]{40}',account)) and account.lower() in [str(x).lower() for x in authority],'paid_role_public_account_unreviewed:'+role)
        try:ref_metadata(matches[0],key=True)
        except GateError as error:e.append(str(error)+':'+role)
    return sorted(set(e)),paid

def check(profile_path,approval_path=None):
    errors=artifact_checks();result={'readyForOperatorStart':False,'readOnly':True,'networkCalls':0,'databasesOpened':False,'artifactsVerified':not errors,'blockers':errors}
    try:
        profile=load(profile_path);result['profileSHA256']=digest(profile_path)
        if profile.get('schema')!=PROFILE_SCHEMA:errors.append('profile_schema_invalid');return result
        selected=[('chain','childChainIdSelected'),('roles','selected'),('authority','selected'),('security','selected'),('security','proposalAccepted'),('pricing','initialRateSelected'),('deployment','createRollupCalldataReady'),('deployment','genesisCanonicalHashSelected'),('license','accepted'),('license','arrangementSelected'),('review','complete'),('review','activationApproved'),('review','financialInputsSelected')]
        for section,key in selected:
            if profile.get(section,{}).get(key) is not True:errors.append('not_selected:'+section+'.'+key)
        if profile.get('runtime',{}).get('binaryPath')!=str(NODE) or profile['runtime'].get('binarySHA256')!=NODE_SHA:errors.append('profile_node_mismatch')
        if profile['runtime'].get('machinesPath')!=str(MACHINES) or profile['runtime'].get('moduleRoot')!=ROOT:errors.append('profile_machine_mismatch')
        if profile['runtime'].get('customSTF') is not False or profile['runtime'].get('modelRequired') is not False:errors.append('custom_stf_or_model_refused')
        if profile.get('chain',{}).get('parentChainId')!=4663:errors.append('profile_parent_mismatch')
        if profile.get('roles',{}).get('mode') not in ['observer','operator']:errors.append('role_mode_unselected')
        child=profile.get('chain',{}).get('childChainIdProposal')
        if type(child) is not int or not 0<child<2**64 or child==4663:errors.append('child_chain_identity_invalid')
        if profile.get('chain',{}).get('nativeTokenSupplyManagementEnabled') is not False or profile.get('chain',{}).get('unbackedNativePremineAllowed') is not False:errors.append('native_supply_override_refused')
        s=profile.get('storage',{});nc=profile.get('nodeConfig',{})
        for key in ['root','chainPath','globalConfigPath']:
            value=s.get(key,'')
            if not persistent(value) or not Path(value).resolve().is_relative_to('/workspace/gl3/mainnet/data'):errors.append('ephemeral_or_invalid_storage:'+key)
        if s.get('dbEngine')!='pebble' or s.get('syncMode') is not True:errors.append('profile_sync_db_required')
        for key,hkey in [('path','SHA256'),('chainInfoPath','chainInfoSHA256'),('genesisPath','genesisSHA256')]:
            if not persistent(nc.get(key,'')) or not isinstance(nc.get(hkey),str) or not re.fullmatch('[0-9a-f]{64}',nc.get(hkey,'')):errors.append('config_bundle_unset:'+key)
        if nc.get('mainnetBootCommand')!=[str(NODE),'--conf.file',nc.get('path')]:errors.append('boot_command_not_canonical')
        if profile.get('review',{}).get('productionConfigSHA256')!=nc.get('SHA256') or nc.get('SHA256') is None:errors.append('reviewed_config_hash_unset_or_mismatch')
        if approval_path is None:errors.append('external_activation_review_missing')
        # Incomplete profiles never cause reads of a config, credential or wallet.
        if errors:return result
        secure_metadata(profile_path);secure_metadata(approval_path);approval=load(approval_path)
        bindings={'profileSHA256':digest(profile_path),'nodeConfigSHA256':nc['SHA256'],'chainInfoSHA256':nc['chainInfoSHA256'],'genesisSHA256':nc['genesisSHA256'],'binarySHA256':NODE_SHA,'moduleRoot':ROOT,'bootstrapSourceSHA256':digest(__file__),'supervisorSourceSHA256':digest(Path(__file__).with_name('operator_runtime.py'))}
        if approval.get('schema')!=REVIEW_SCHEMA or approval.get('operatorReviewed') is not True or approval.get('activationApproved') is not True or any(approval.get(k)!=v for k,v in bindings.items()):errors.append('activation_review_binding_mismatch');return result
        for key,hkey in [('path','SHA256'),('chainInfoPath','chainInfoSHA256'),('genesisPath','genesisSHA256')]:
            secure_metadata(nc[key],private=key=='path')
            if digest(nc[key])!=nc[hkey]:errors.append('bundle_hash_mismatch:'+key)
        if errors:return result
        cfg=load(nc['path']);more,paid=config_checks(profile,cfg);errors.extend(more)
        try:ref_metadata(profile.get('parentRPC',{}))
        except GateError as error:errors.append(str(error))
        info=load(nc['chainInfoPath']);items=info if isinstance(info,list) else [info]
        selected_info=[x for x in items if x.get('chain-id')==profile['chain']['childChainIdProposal']]
        if len(selected_info)!=1 or selected_info[0].get('parent-chain-id')!=4663:errors.append('chain_info_identity_mismatch')
        elif str(selected_info[0].get('rollup',{}).get('native-token','')).lower()!=str(profile['chain']['nativeToken']).lower():errors.append('chain_info_native_token_mismatch')
        genesis=load(nc['genesisPath'])
        serialized=genesis.get('serializedChainConfig')
        try:gcfg=json.loads(serialized);valid=gcfg['chainId']==profile['chain']['childChainIdProposal'] and gcfg['arbitrum'].get('AllowDebugPrecompiles') is False
        except Exception:valid=False
        if not valid:errors.append('genesis_chain_or_debug_mismatch')
        if genesis.get('arbOSInit',{}).get('nativeTokenSupplyManagementEnabled') is not False:errors.append('genesis_native_supply_override_refused')
        if any(int(x.get('balance','0'),0) if isinstance(x.get('balance','0'),str) else x.get('balance',0) for x in genesis.get('alloc',{}).values()):errors.append('unbacked_genesis_allocation_refused')
        layout=database_layout(s['chainPath']);result['databaseLayoutMetadata']=layout
        if layout=='partial_or_unrecognized':errors.append('partial_or_unrecognized_db_layout_refused')
        elif layout in ['missing','empty'] and approval.get('allowInitialGenesis') is not True:errors.append('missing_or_empty_db_requires_explicit_initial_genesis_review')
        result['paidRoles']=paid;result['readyForOperatorStart']=not errors
        return result
    except (GateError,KeyError,TypeError,ValueError,OSError):errors.append('profile_or_bundle_validation_failed');return result
    finally:result['blockers']=sorted(set(errors))

def database_layout(path):
    # Metadata only: never opens CURRENT, MANIFEST or any active DB file.
    root=Path(path)
    if not root.exists():return 'missing'
    if root.is_symlink() or not root.is_dir():return 'partial_or_unrecognized'
    if not any(root.iterdir()):return 'empty'
    for name in ['l2chaindata','arbitrumdata','wasm']:
        directory=root/'nitro'/name;current=directory/'CURRENT'
        if directory.is_symlink() or not directory.is_dir() or current.is_symlink() or not current.is_file():return 'partial_or_unrecognized'
        if not any(p.is_file() and not p.is_symlink() for p in directory.glob('MANIFEST-*')):return 'partial_or_unrecognized'
    return 'complete_markers'

def secret_rpc(ref):
    # Called only by explicitly reviewed --start, never --check or --dry-run.
    ref_metadata(ref)
    if ref['source']=='env':value=os.environ[ref['name']]
    else:
        with Path(ref['path']).open('rb') as stream:raw=stream.read(16385)
        if len(raw)>16384:raise GateError('parent_rpc_reference_too_large')
        value=raw.decode().strip()
    if not value or len(value)>16384 or any(c in value for c in '\r\n'):raise GateError('parent_rpc_reference_invalid')
    parsed=urllib.parse.urlparse(value)
    if parsed.scheme!='https' and not (parsed.scheme=='http' and parsed.hostname in ['localhost','127.0.0.1','::1']):raise GateError('parent_rpc_transport_refused')
    if not parsed.hostname:raise GateError('parent_rpc_reference_invalid')
    return value

def start(profile_path,approval_path):
    result=check(profile_path,approval_path)
    if not result['readyForOperatorStart']:raise GateError('operator_start_not_reviewed')
    profile=load(profile_path);cfg=load(profile['nodeConfig']['path']);fingerprint=digest(profile_path)
    with tempfile.TemporaryDirectory(prefix='gl3-private-',dir='/run') as run:
        effective=Path(run)/'node.effective.json'
        cfg['parent-chain']['connection']['url']=secret_rpc(profile['parentRPC'])
        for ref in profile['roles']['secretReferences']:
            role=ref.get('role')
            if role not in result.get('paidRoles',[]):continue
            section='batch-poster' if role=='batch-poster' else 'staker'
            wallet=cfg.get('node',{}).get(section,{}).get('parent-chain-wallet',{})
            if wallet.get('password')=='$GL3_WALLET_PASSWORD':
                value=os.environ[ref['passwordEnv']]
                if len(value)>4096:raise GateError('wallet_password_reference_invalid')
                wallet['password']=value
        fd=os.open(effective,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'w') as stream:json.dump(cfg,stream)
        def before_start():
            if digest(profile_path)!=fingerprint or not check(profile_path,approval_path)['readyForOperatorStart']:raise GateError('reviewed_inputs_changed')
        env={key:os.environ[key] for key in ['PATH','HOME','TMPDIR','LANG','TZ'] if key in os.environ}
        argv=[str(NODE),'--conf.file',str(effective)]
        sup=Supervisor(argv,Path(profile['storage']['root'])/'supervision',env=env,cwd='/workspace/gl3',before_start=before_start)
        return sup.run()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group(required=True)
    for name in ['check','dry-run','install-aliases','start']:mode.add_argument('--'+name,action='store_true')
    parser.add_argument('--profile',type=Path);parser.add_argument('--approval-receipt',type=Path)
    args=parser.parse_args()
    try:
        if args.install_aliases:
            print(json.dumps({'installedUnderExplicitFlag':True,'plan':install_aliases()}));return 0
        if args.profile is None:raise GateError('profile_path_required')
        if args.start:
            result=start(args.profile,args.approval_receipt);print(json.dumps(result));return result['exitCode']
        result=check(args.profile,args.approval_receipt)
        try:result['aliasPlan']=alias_plan()
        except GateError:result['aliasPlanStatus']='not_installable_without_operator_review'
        result['mode']='dry-run' if args.dry_run else 'check';print(json.dumps(result,indent=2));return 0 if result['readyForOperatorStart'] else 2
    except (GateError,SupervisionError,OSError):
        print(json.dumps({'readyForOperatorStart':False,'error':'bootstrap_failed_closed','secretValuesEchoed':False}));return 2
if __name__=='__main__':raise SystemExit(main())
