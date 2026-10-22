// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

library S0ULIntelTypes {
    enum ReaderKind { None, ERC20Supply, ERC20Balance, UniswapV2 }
    enum ReadStatus {
        Ok, Disabled, CodeChanged, CallFailed, Malformed, OutOfRange,
        MetadataChanged, TooSoon, NoSamples, NoHistory, Stale
    }
    uint8 internal constant FLAG_HISTORY = 1;
    uint8 internal constant FLAG_FRESH = 2;
    uint8 internal constant FLAG_READER_OK = 4;
    uint8 internal constant FLAG_ZERO_BASELINE = 8;
    uint8 internal constant FLAG_CLIPPED = 16;

    struct Subject {
        ReaderKind kind;
        bool enabled;
        address target;
        address account;
        bytes32 codeHash;
        address asset0;
        address asset1;
        uint64 sequence;
        ReadStatus lastStatus;
    }
    struct Snapshot {
        uint64 sequence;
        uint64 timestamp;
        uint64 blockNumber;
        // The current block's hash is unavailable to EVM code. This is the
        // preceding block's hash, not a claim about the sampling block's hash.
        bytes32 parentBlockHash;
        // Supply: [supply,0,0,0]. Balance: [accountBalance,supply,0,0].
        // V2: [reserve0,reserve1,LPsupply,poolTimestampLast]. Raw integer units.
        uint128[4] values;
    }
    struct FeatureFrame {
        uint256 subjectId;
        ReaderKind kind;
        Snapshot current;
        Snapshot previous;
        bytes32 currentHash;
        bytes32 previousHash;
        // 0..2: bounded relative changes of values0..2 in basis points.
        // 3: V2 reserve1/reserve0 ratio change in bounded basis points.
        // 4: registered account's current supply share, 0..10000 basis points.
        // 5: elapsed seconds capped at 86400. 6: ReaderKind. 7: flags above.
        // Relative changes clip to [-10000,10000]; undefined zero baselines
        // produce 0 (both zero) or +10000 and set FLAG_ZERO_BASELINE.
        int32[8] vector;
        uint32 elapsedSeconds;
        uint8 flags;
        bool hasHistory;
        bool fresh;
        ReadStatus status;
    }
}
