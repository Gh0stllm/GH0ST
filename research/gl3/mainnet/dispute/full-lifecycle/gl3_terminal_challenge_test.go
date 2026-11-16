//go:build gl3_acceptance && challengetest

// SPDX-License-Identifier: GPL-3.0-or-later
package arbtest

import (
 "context"
 "encoding/json"
 "os"
 "path/filepath"
 "testing"
 "time"

 "github.com/ethereum/go-ethereum/accounts/abi/bind"
 "github.com/ethereum/go-ethereum/common"
 "github.com/ethereum/go-ethereum/core/types"
 "github.com/offchainlabs/nitro/arbnode"
 "github.com/offchainlabs/nitro/bold/commitment/history"
 "github.com/offchainlabs/nitro/bold/protocol"
 "github.com/offchainlabs/nitro/bold/state"
 "github.com/offchainlabs/nitro/solgen/go/challengeV2gen"
 "github.com/offchainlabs/nitro/solgen/go/rollupgen"
 "github.com/offchainlabs/nitro/util/containers"
 "github.com/offchainlabs/nitro/validator"
 "github.com/offchainlabs/nitro/validator/server_arb"
)

// Test-only dishonest claimant: the actual node and engine stay honest. Only
// claims about the completed engine block are falsified. Both parties share the
// real state backend; every returned slice/state is copied before modification.
type gl3FalseTerminalClaim struct {
 BoldStateProviderInterface
 honestFinished common.Hash
 falseFinished common.Hash
 trueGlobal protocol.GoGlobalState
 falseGlobal protocol.GoGlobalState
}

func (s *gl3FalseTerminalClaim) ExecutionStateAfterPreviousState(ctx context.Context, limit uint64, prev protocol.GoGlobalState) (*protocol.ExecutionState,error) {
 actual,err:=s.BoldStateProviderInterface.ExecutionStateAfterPreviousState(ctx,limit,prev);if err!=nil{return nil,err}
 result:=*actual
 if result.GlobalState==s.trueGlobal {result.GlobalState=s.falseGlobal}
 leaves,err:=s.L2MessageStatesUpTo(ctx,prev,state.Batch(limit),containers.Some(state.Height(blockChallengeLeafHeight)));if err!=nil{return nil,err}
 commitment,err:=history.NewCommitment(leaves,blockChallengeLeafHeight+1);if err!=nil{return nil,err}
 result.EndHistoryRoot=commitment.Merkle
 return &result,nil
}

func (s *gl3FalseTerminalClaim) L2MessageStatesUpTo(ctx context.Context, from protocol.GoGlobalState, limit state.Batch, to containers.Option[state.Height]) ([]common.Hash,error) {
 original,err:=s.BoldStateProviderInterface.L2MessageStatesUpTo(ctx,from,limit,to);if err!=nil{return nil,err}
 result:=append([]common.Hash(nil),original...)
 for i:=range result {if result[i]==s.honestFinished {result[i]=s.falseFinished}}
 return result,nil
}

func (s *gl3FalseTerminalClaim) CollectMachineHashes(ctx context.Context,cfg *state.HashCollectorConfig) ([]common.Hash,error) {
 original,err:=s.BoldStateProviderInterface.CollectMachineHashes(ctx,cfg);if err!=nil{return nil,err}
 result:=append([]common.Hash(nil),original...)
 for i:=range result {if result[i]==s.honestFinished {result[i]=s.falseFinished}}
 return result,nil
}

// CollectProof is deliberately the unchanged honest implementation. The false
// terminal state cannot acquire a valid proof merely by changing its claim.

func gl3RunTerminalChallenge(t *testing.T,ctx context.Context,b *NodeBuilder,terminal *types.Receipt,final validator.GoGlobalState,out string) {
 t.Helper()
 started:=time.Now()
 write:=func(name string,value any){data,err:=json.MarshalIndent(value,"","  ");Require(t,err);Require(t,os.WriteFile(filepath.Join(out,name),append(data,'\n'),0600))}
 report:=map[string]any{"passed":false,"scope":"Actual private BoLD assertion/history/one-step lifecycle over a deliberately false completed-engine-block claim; unchanged full24m native decision; no public funds","fullStrengthDecisionVerified":true,"terminalComputeBlock":terminal.BlockHash,"moduleRoot":"0xc03cf6f44fe1ca3c0826064ba7e5a3c134dc0013a9b994f3355f2ba185116c00","seededChallengeEdges":false,"syntheticHistorySiblings":false,"privilegedFastConfirmation":false,"publicDeployment":false,"enginePolicyChanged":false,"allExecutionOnRunpod":true,"backgroundAllBlocksValidatorEnabled":false,"backgroundValidationGateAssumedByFixture":true,"stakeSettlementPassed":false,"assertionConfirmationPassed":false,"honestOneStepWinner":false}
 defer func(){report["seconds"]=time.Since(started).Seconds();write("full-lifecycle-result.json",report)}()
 write("full-lifecycle-progress.json",map[string]any{"phase":"STARTING_REAL_CHALLENGE_STACKS","terminal":terminal.BlockHash})
 evilConfig:=arbnode.ConfigDefaultL1NonSequencerTest()
 evilConfig.BlockValidator.Enable=false
 evilNode,cleanup:=b.Build2ndNode(t,&SecondNodeParams{nodeConfig:evilConfig});defer cleanup()
 b.L1Info.GenerateAccount("HonestAsserter");fundBoldStaker(t,ctx,b,"HonestAsserter")
 b.L1Info.GenerateAccount("EvilAsserter");fundBoldStaker(t,ctx,b,"EvilAsserter")
 var shared BoldStateProviderInterface
 chain,stopHonest:=startBoldChallengeManager(t,ctx,b,b.L2,"HonestAsserter",func(real BoldStateProviderInterface) BoldStateProviderInterface {shared=real;return real});defer stopHonest()
 if shared==nil {t.Fatal("missing actual state provider")}
 trueFinished:=server_arb.NewFinishedMachine(final);correctHash:=trueFinished.Hash();trueFinished.Destroy()
 forged:=final;forged.BlockHash[31]^=1
 falseFinished:=server_arb.NewFinishedMachine(forged);falseHash:=falseFinished.Hash();falseFinished.Destroy()
 liar:=&gl3FalseTerminalClaim{BoldStateProviderInterface:shared,honestFinished:correctHash,falseFinished:falseHash,trueGlobal:protocol.GoGlobalState{BlockHash:final.BlockHash,SendRoot:final.SendRoot,Batch:final.Batch,PosInBatch:final.PosInBatch},falseGlobal:protocol.GoGlobalState{BlockHash:forged.BlockHash,SendRoot:forged.SendRoot,Batch:forged.Batch,PosInBatch:forged.PosInBatch}}
 _,stopEvil:=startBoldChallengeManager(t,ctx,b,evilNode,"EvilAsserter",func(_ BoldStateProviderInterface) BoldStateProviderInterface{return liar});defer stopEvil()
 managerAddr:=chain.SpecChallengeManager().Address()
 manager,err:=challengeV2gen.NewEdgeChallengeManager(managerAddr,b.L1.Client);Require(t,err)
 rollup,err:=rollupgen.NewRollupUserLogic(b.addresses.Rollup,b.L1.Client);Require(t,err)
 report["rollup"]=b.addresses.Rollup;report["challengeManager"]=managerAddr
 report["trueTerminalState"]=final;report["falseTerminalState"]=forged
 report["correctFinishedHash"]=correctHash;report["falseFinishedHash"]=falseHash
 var cursor uint64
 ticker:=time.NewTicker(time.Second);defer ticker.Stop()
 winner:=false;confirmed:=false
 correctAssertions:=map[[32]byte]bool{};incorrectAssertions:=map[[32]byte]bool{}
 honestLayerZero:=map[[32]byte]bool{}
 for {
  select {
  case <-ctx.Done():t.Fatal("challenge context ended before every required gate passed",ctx.Err())
  case <-ticker.C:
   latest,err:=b.L1.Client.HeaderByNumber(ctx,nil);Require(t,err);end:=latest.Number.Uint64();if end<cursor {continue}
   opts:=&bind.FilterOpts{Start:cursor,End:&end,Context:ctx}
   claims,err:=rollup.FilterAssertionCreated(opts,nil,nil);Require(t,err)
   for claims.Next(){e:=claims.Event;tx,_,err:=b.L1.Client.TransactionByHash(ctx,e.Raw.TxHash);Require(t,err);sender,err:=types.Sender(types.LatestSignerForChainID(tx.ChainId()),tx);Require(t,err)
    if sender==b.L1Info.GetAddress("HonestAsserter"){correctAssertions[e.AssertionHash]=true}
    if sender==b.L1Info.GetAddress("EvilAsserter"){incorrectAssertions[e.AssertionHash]=true}
   };Require(t,claims.Error());Require(t,claims.Close())
   edges,err:=manager.FilterEdgeAdded(opts,nil,nil,nil);Require(t,err)
   for edges.Next(){e:=edges.Event;if !e.IsLayerZero {continue};edge,err:=manager.GetEdge(&bind.CallOpts{Context:ctx},e.EdgeId);Require(t,err);if edge.Staker==b.L1Info.GetAddress("HonestAsserter"){honestLayerZero[e.EdgeId]=true}}
   Require(t,edges.Error());Require(t,edges.Close())
   proofs,err:=manager.FilterEdgeConfirmedByOneStepProof(opts,nil,nil);Require(t,err)
   for proofs.Next(){e:=proofs.Event;tx,_,err:=b.L1.Client.TransactionByHash(ctx,e.Raw.TxHash);Require(t,err);sender,err:=types.Sender(types.LatestSignerForChainID(tx.ChainId()),tx);Require(t,err);if sender!=b.L1Info.GetAddress("HonestAsserter"){t.Fatal("incorrect claimant won actual one-step dispute",sender)};winner=true;report["honestOneStepWinner"]=true;report["oneStepTransaction"]=e.Raw.TxHash;report["oneStepEdge"]=e.EdgeId;write("full-lifecycle-one-step.json",report)}
   Require(t,proofs.Error());Require(t,proofs.Close())
   confirmations,err:=rollup.FilterAssertionConfirmed(opts,nil);Require(t,err)
   for confirmations.Next(){e:=confirmations.Event;if incorrectAssertions[e.AssertionHash]{t.Fatal("incorrect assertion confirmed",e.AssertionHash)};if winner&&correctAssertions[e.AssertionHash]{confirmed=true;report["assertionConfirmationPassed"]=true;report["confirmedAssertion"]=e.AssertionHash;report["confirmationTransaction"]=e.Raw.TxHash}}
   Require(t,confirmations.Error());Require(t,confirmations.Close())
   cursor=end+1
   write("full-lifecycle-progress.json",map[string]any{"phase":"REAL_ASSERTION_CHALLENGE_RUNNING","seconds":time.Since(started).Seconds(),"parentBlock":end,"correctAssertions":len(correctAssertions),"incorrectAssertions":len(incorrectAssertions),"honestLayerZeroEdges":len(honestLayerZero),"honestOneStepWinner":winner,"honestAssertionConfirmed":confirmed})
   if !winner||!confirmed {continue}
   refunded:=0
   for id:=range honestLayerZero {edge,err:=manager.GetEdge(&bind.CallOpts{Context:ctx},id);Require(t,err);if edge.Status!=1 {continue};if !edge.Refunded {auth:=b.L1Info.GetDefaultTransactOpts("HonestAsserter",ctx);tx,err:=manager.RefundStake(&auth,id);Require(t,err);_,err=b.L1.EnsureTxSucceeded(tx);Require(t,err);edge,err=manager.GetEdge(&bind.CallOpts{Context:ctx},id);Require(t,err)};if !edge.Refunded {t.Fatal("confirmed honest edge stake not refunded")};refunded++}
   if refunded==0 {continue}
   for id:=range incorrectAssertions {claim,err:=rollup.GetAssertion(&bind.CallOpts{Context:ctx},id);Require(t,err);if claim.Status==2 {t.Fatal("incorrect assertion gained confirmed status")}}
   report["stakeSettlementPassed"]=true;report["honestLayerZeroRefunds"]=refunded;report["incorrectAssertionsRemainUnconfirmed"]=true;report["passed"]=true
   return
  }
 }
}
