import {Actor,HttpAgent} from '@icp-sdk/core/agent';
import {Principal} from '@icp-sdk/core/principal';
export const registryId='ggcey-baaaa-aaaao-bbsgq-cai';
export const principal=value=>Principal.fromText(value);
function idl({IDL:I}){
  const Config=I.Record({name:I.Text,personality:I.Text,addresses:I.Vec(I.Text),tools:I.Vec(I.Text),daily_cap:I.Nat32});
  const Activity=I.Record({id:I.Nat64,at:I.Nat64,address:I.Text,status:I.Text,source_block:I.Opt(I.Nat64),source_at:I.Opt(I.Nat64),lines:I.Vec(I.Text),fee:I.Nat32});
  const Project=I.Record({owner:I.Principal,config:Config,created_at:I.Nat64,updated_at:I.Nat64,activity:I.Vec(Activity)});
  return I.Service({spawn_get:I.Func([I.Principal],[I.Opt(Project)],['query']),
    spawn_save:I.Func([Config],[I.Variant({Ok:Project,Err:I.Text})],[]),
    spawn_run:I.Func([I.Text],[I.Variant({Ok:Activity,Err:I.Text})],[])});
}
export async function registry(identity) {
  const agent=await HttpAgent.create({host:'https://icp-api.io',identity});
  return Actor.createActor(idl,{agent,canisterId:registryId});
}
export function unwrap(reply){
  if('Err' in reply)throw new Error(reply.Err);
  return reply.Ok;
}
