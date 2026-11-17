// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "../../contracts/GL3ZkCoordinator.sol";

interface IGL3BridgeBootstrap {
    function initialize(address rollup,address nativeToken) external;
    function setSequencerInbox(address sequencerInbox) external;
    function setDelayedInbox(address inbox,bool enabled) external;
    function setOutbox(address outbox,bool enabled) external;
    function enqueueDelayedMessage(uint8 kind,address sender,bytes32 dataHash,uint256 tokenAmount) external returns(uint256);
}
interface IGL3InboxBootstrap {function initialize(address bridge,address sequencerInbox) external;}
interface IGL3OutboxBootstrap {function initialize(address bridge) external;}
interface IGL3SequencerBootstrap {
    struct TimeVariation {uint256 delayBlocks;uint256 futureBlocks;uint256 delaySeconds;uint256 futureSeconds;}
    struct BufferConfig {uint64 threshold;uint64 max;uint64 replenishRateInBasis;}
    function initialize(address bridge,TimeVariation calldata variation,BufferConfig calldata buffer,address feeTokenPricer) external;
    function setIsBatchPoster(address poster,bool allowed) external;
    function setIsSequencer(address sequencer,bool allowed) external;
}

/// @notice Research candidate: fresh immutable native-GH0ST graph factory.
/// @dev No existing graph, generic administrative call or root publisher can be
/// supplied. The immutable deployment authority can create new independent
/// chains, and cannot modify an existing graph. Not mainnet-accepted.
contract GL3NativeFactory {
    uint8 public constant INITIALIZATION_ADAPTER_VERSION=1;
    uint8 public constant INITIALIZATION_MESSAGE_KIND=11;
    uint256 public constant MAX_CHAIN_CONFIG_BYTES=104792;
    uint256 public constant MAX_INITIAL_POSTERS=64;

    address public immutable deploymentAuthority;
    address public immutable bridgeImplementation;
    address public immutable inboxImplementation;
    address public immutable sequencerInboxImplementation;
    address public immutable outboxImplementation;
    bytes32 public immutable implementationCodeHashes;
    mapping(address=>bytes32) public createdGraphHash;
    bool private creating;

    struct BootstrapConfig {
        address feeTokenPricer;
        IGL3SequencerBootstrap.TimeVariation timeVariation;
        IGL3SequencerBootstrap.BufferConfig bufferConfig;
        address[] batchPosters;
        address[] sequencers;
        string serializedChainConfig;
        uint256 explicitInitialDataCostEstimate;
    }

    error InvalidFactoryConfiguration();
    error UnauthorizedDeployment();
    error InvalidBootstrapConfiguration();
    error CloneCreationFailed();
    error InitializationFailed();

    event InboxMessageDelivered(uint256 indexed messageNum,bytes data);
    event ChainCreated(address indexed coordinator,bytes32 indexed graphHash,bytes32 domain,
        bytes32 chainConfigHash,bytes32 initializationMessageHash);

    constructor(address authority,GL3ZkCoordinator.Implementations memory implementations_) {
        if(authority==address(0) || implementations_.bridge.code.length==0 ||
            implementations_.inbox.code.length==0 || implementations_.sequencerInbox.code.length==0 ||
            implementations_.outbox.code.length==0) revert InvalidFactoryConfiguration();
        deploymentAuthority=authority;
        bridgeImplementation=implementations_.bridge;
        inboxImplementation=implementations_.inbox;
        sequencerInboxImplementation=implementations_.sequencerInbox;
        outboxImplementation=implementations_.outbox;
        implementationCodeHashes=_implementationHashes(implementations_);
    }

    function implementations() public view returns(GL3ZkCoordinator.Implementations memory) {
        return GL3ZkCoordinator.Implementations({bridge:bridgeImplementation,inbox:inboxImplementation,
            sequencerInbox:sequencerInboxImplementation,outbox:outboxImplementation});
    }

    function predictGraph(address coordinator) external view returns(GL3ZkCoordinator.Graph memory) {
        return GL3ZkCoordinator.Graph({bridge:_predict(coordinator,0,bridgeImplementation),
            inbox:_predict(coordinator,1,inboxImplementation),
            sequencerInbox:_predict(coordinator,2,sequencerInboxImplementation),
            outbox:_predict(coordinator,3,outboxImplementation)});
    }

    function createChain(GL3ZkCoordinator.ProofConfig calldata proofConfig,
        GL3ZkTypes.GlobalState calldata genesis,BootstrapConfig calldata bootstrap)
        external returns(address coordinatorAddress,GL3ZkCoordinator.Graph memory graph)
    {
        if(msg.sender!=deploymentAuthority || creating) revert UnauthorizedDeployment();
        if(bytes(bootstrap.serializedChainConfig).length==0 ||
            bytes(bootstrap.serializedChainConfig).length>MAX_CHAIN_CONFIG_BYTES ||
            bootstrap.explicitInitialDataCostEstimate==0 ||
            bootstrap.batchPosters.length==0 || bootstrap.batchPosters.length>MAX_INITIAL_POSTERS ||
            bootstrap.sequencers.length>MAX_INITIAL_POSTERS) revert InvalidBootstrapConfiguration();
        GL3ZkCoordinator.Implementations memory impl=implementations();
        if(_implementationHashes(impl)!=implementationCodeHashes) revert InvalidFactoryConfiguration();
        creating=true;
        GL3ZkCoordinator coordinator=new GL3ZkCoordinator(proofConfig,impl,genesis);
        coordinatorAddress=address(coordinator);
        graph.bridge=_clone(coordinatorAddress,0,impl.bridge);
        IGL3BridgeBootstrap(graph.bridge).initialize(coordinatorAddress,proofConfig.nativeToken);
        graph.sequencerInbox=_clone(coordinatorAddress,2,impl.sequencerInbox);
        IGL3SequencerBootstrap(graph.sequencerInbox).initialize(graph.bridge,bootstrap.timeVariation,
            bootstrap.bufferConfig,bootstrap.feeTokenPricer);
        graph.inbox=_clone(coordinatorAddress,1,impl.inbox);
        IGL3InboxBootstrap(graph.inbox).initialize(graph.bridge,graph.sequencerInbox);
        graph.outbox=_clone(coordinatorAddress,3,impl.outbox);
        IGL3OutboxBootstrap(graph.outbox).initialize(graph.bridge);
        IGL3BridgeBootstrap bridge=IGL3BridgeBootstrap(graph.bridge);
        bridge.setSequencerInbox(graph.sequencerInbox);
        bridge.setDelayedInbox(graph.inbox,true);
        bridge.setOutbox(graph.outbox,true);
        _setPostingRoles(graph.sequencerInbox,bootstrap.batchPosters,bootstrap.sequencers);

        // Canonical ERC20RollupEventInbox's explicit-cost branch, version1:
        // chainId32 || initVersion1 || dataCost32 || serializedChainConfig.
        // This factory is an allowed Inbox only for this atomic initialization.
        bytes memory initData=abi.encodePacked(proofConfig.childChainId,uint8(1),
            bootstrap.explicitInitialDataCostEstimate,bootstrap.serializedChainConfig);
        bridge.setDelayedInbox(address(this),true);
        uint256 messageNum=bridge.enqueueDelayedMessage(INITIALIZATION_MESSAGE_KIND,
            address(0),keccak256(initData),0);
        if(messageNum!=0) revert InitializationFailed();
        emit InboxMessageDelivered(messageNum,initData);
        bridge.setDelayedInbox(address(this),false);

        bytes32 graphHash=keccak256(abi.encode(graph));
        createdGraphHash[coordinatorAddress]=graphHash;
        coordinator.seal(graph,impl);
        if(!coordinator.bootstrapSealed() || coordinator.owner()!=address(0)) revert InitializationFailed();
        emit ChainCreated(coordinatorAddress,graphHash,coordinator.domain(),
            keccak256(bytes(bootstrap.serializedChainConfig)),keccak256(initData));
        creating=false;
    }

    function _setPostingRoles(address sequencerInbox,address[] calldata posters,address[] calldata sequencers) private {
        for(uint256 i=0;i<posters.length;i++){
            if(posters[i]==address(0)) revert InvalidBootstrapConfiguration();
            for(uint256 j=0;j<i;j++)if(posters[i]==posters[j])revert InvalidBootstrapConfiguration();
            IGL3SequencerBootstrap(sequencerInbox).setIsBatchPoster(posters[i],true);
        }
        for(uint256 i=0;i<sequencers.length;i++){
            if(sequencers[i]==address(0)) revert InvalidBootstrapConfiguration();
            for(uint256 j=0;j<i;j++)if(sequencers[i]==sequencers[j])revert InvalidBootstrapConfiguration();
            IGL3SequencerBootstrap(sequencerInbox).setIsSequencer(sequencers[i],true);
        }
    }

    function _clone(address coordinator,uint8 role,address implementation) private returns(address instance) {
        bytes memory code=_creationCode(implementation);bytes32 salt=keccak256(abi.encode(coordinator,role));
        assembly {instance:=create2(0,add(code,32),mload(code),salt)}
        if(instance==address(0)) revert CloneCreationFailed();
    }
    function _predict(address coordinator,uint8 role,address implementation) private view returns(address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff),address(this),
            keccak256(abi.encode(coordinator,role)),keccak256(_creationCode(implementation)))))));
    }
    function _creationCode(address implementation) private pure returns(bytes memory) {
        return abi.encodePacked(hex"3d602d80600a3d3981f3",hex"363d3d373d3d3d363d73",implementation,
            hex"5af43d82803e903d91602b57fd5bf3");
    }
    function _implementationHashes(GL3ZkCoordinator.Implementations memory impl) private view returns(bytes32) {
        return keccak256(abi.encode(impl.bridge.codehash,impl.inbox.codehash,
            impl.sequencerInbox.codehash,impl.outbox.codehash));
    }
}
