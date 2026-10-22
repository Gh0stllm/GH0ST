// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Independently trained numeric observation router, not S0UL's 984k LM.
/// @dev Synthetic policy routing is not a market forecast or a security verdict.
///      Every score is an uncalibrated integer discriminant, never confidence.
contract S0ULIntelModel {
    error InvalidFeatureVector();
    bytes32 public constant modelId = hex"033f3bbf93ed8c7465a86389cd01aecb8fa64a582dfd9ff403da7b47fe04cbbd";
    bytes32 public constant trainingManifestHash = hex"06c8d5497bba57f04b6418dd1510711cfe9383450a1464b6d73d9169f9a6c070";
    bytes32 public constant weightsHash = hex"9c5c068599f09de30b16a8f106476e1912ef78788f0ac5bace887b22f790fd9a";
    bytes32 public constant trainingDataHash = hex"d279784dd86802fb1939fd5d7d4db298129179348f141fe8337bc4dc190a3a36";
    uint16 public constant learnedParameterCount = 25;
    uint16 public constant baselineObservationBps = 250;
    int256 public constant MASKED_SCORE = -int256(1 << 120);

    /// @return label 0 normal, 1 supply, 2 watched balance, 3 LP liquidity,
    ///         4 reserve-ratio price change, 5 insufficient/undefined history.
    /// @return scores Integer scores in label order. Inactive labels are masked.
    function classify(int32[8] calldata v) external pure returns (uint8 label, int256[6] memory scores) {
        for (uint256 i; i < 4; ++i) if (v[i] < -10000 || v[i] > 10000) revert InvalidFeatureVector();
        if (v[4] < 0 || v[4] > 10000 || v[5] < 0 || v[5] > 86400
            || v[6] < 1 || v[6] > 3 || v[7] < 0 || v[7] > 31) revert InvalidFeatureVector();
        for (uint256 i; i < 6; ++i) scores[i] = MASKED_SCORE;
        uint8 flags = uint8(uint32(v[7]));
        // Eligibility is an explicit deterministic guard, not a learned score.
        if ((flags & 7) != 7 || (flags & 8) != 0) { scores[5] = 0; return (5, scores); }
        int256[4] memory x;
        if (v[6] == 1) x[0] = _abs(v[0]);
        else if (v[6] == 2) x[1] = _abs(v[0]);
        else { x[2] = _abs(v[2]); x[3] = _abs(v[3]); }
        // Actual quantized output of intel-model/train.py, not hand-set weights.
        int16[20] memory w = [int16(0), 0, 0, 0, 1024, 0, 0, 0, 0, 1024, 0, 0, 0, 0, 1024, 0, 0, 0, 0, 1024];
        int64[5] memory b = [int64(256000), 0, 0, 0, 0];
        for (uint256 row; row < 5; ++row) {
            bool active = row == 0 || (v[6] == 1 && row == 1)
                || (v[6] == 2 && row == 2) || (v[6] == 3 && (row == 3 || row == 4));
            if (!active) continue;
            int256 score = int256(b[row]);
            for (uint256 col; col < 4; ++col) score += int256(w[row * 4 + col]) * x[col];
            scores[row] = score;
        }
        // Strict greater-than preserves the lowest label on an exact tie.
        for (uint8 i = 1; i < 6; ++i) if (scores[i] > scores[label]) label = i;
    }

    function _abs(int32 n) private pure returns (int256) { return n < 0 ? -int256(n) : int256(n); }
}
