from pathlib import Path
p=Path(__file__).parent
source=(p.parent/'sentence/NovaSentencePoolHook.sol').read_text()
a=source.index('    function _infer(')
b=source.index('    /// @dev Ignores arbitrary hookData.',a)
new='''    /// @dev Both buffers are allocated once by afterSwap. The decoder validates the
    /// canonical raw model return before any typed pointer is borrowed from it.
    function _inferBuffered(Context memory c, int16[768] memory state,
        bytes memory input, bytes memory decoderInput, Generation memory output) private view
    {
        if (address(model).codehash != modelCodeHash) revert WordRequired(2);
        address target = address(model);
        uint256 budget = inferenceGasLimit;
        uint256 token = c.previousToken;
        uint256 punct = c.previousPunct;
        uint256 sequence = c.sequence;
        uint256 modelSize;
        bool ok;
        assembly ("memory-safe") {
            let callData := add(input, 32)
            mstore(add(callData, 4), token)
            mstore(add(callData, 36), punct)
            mcopy(add(callData, 68), state, 24576)
            mstore(add(callData, 24868), sequence)
            // decodeStep(bytes): selector + offset + length precede raw model ABI.
            ok := staticcall(budget, target, callData, 24932, add(decoderInput, 100), 31104)
            modelSize := returndatasize()
        }
        if (!ok || modelSize < 31_072 || modelSize > MAX_RETURN_BYTES) revert WordRequired(3);
        uint256 decoderBudget = DECODER_GAS_LIMIT;
        assembly ("memory-safe") {
            mstore(add(decoderInput, 68), modelSize)
            // The original self-call still executes every validation. Its large
            // return value is discarded; the validated input is already in memory.
            ok := staticcall(decoderBudget, address(), add(decoderInput, 32), add(68, modelSize), 0, 0)
        }
        if (!ok) revert WordRequired(4);
        assembly ("memory-safe") {
            let raw := add(decoderInput, 100)
            mstore(output, mload(raw))
            mstore(add(output, 32), mload(add(raw, 32)))
            mstore(add(output, 64), add(raw, 64))
            mstore(add(output, 96), add(raw, 24640))
            mstore(add(output, 128), add(raw, 31008))
            mstore(add(output, 160), mload(add(raw, 30976)))
        }
    }

    /// @dev Same abi.encode(modelHash,id,sequence,token,punct,state) bytes as before.
    function _nextStateHash(bytes memory buffer, bytes32 id, uint64 sequence,
        uint16 token, uint8 punct, int16[768] memory state) private view returns (bytes32 hash)
    {
        bytes32 identity = modelHash;
        assembly ("memory-safe") {
            let data := add(buffer, 32)
            mstore(data, identity)
            mstore(add(data, 32), id)
            mstore(add(data, 64), sequence)
            mstore(add(data, 96), token)
            mstore(add(data, 128), punct)
            mcopy(add(data, 160), state, 24576)
            hash := keccak256(data, 24736)
        }
    }

    /// @dev Emits the exact standard WordSpoken ABI with a reusable bounded buffer.
    function _emitBufferedWord(bytes memory buffer, bytes32 id, Context memory c,
        Generation memory generated, uint256 sampleIndex, int32[6] memory features,
        bytes32 previousHash) private
    {
        bytes32 signature = keccak256("WordSpoken(bytes32,uint64,bytes32,uint16,uint8,string,bool,uint256,int32[6],int256[197],bytes32,bytes32)");
        bytes32 identity = modelHash;
        uint256 sequence = c.sequence;
        bytes32 stateHash = c.stateHash;
        assembly ("memory-safe") {
            let data := add(buffer, 32)
            mstore(data, mload(generated))
            mstore(add(data, 32), mload(add(generated, 32)))
            mstore(add(data, 64), 6720)
            mstore(add(data, 96), mload(add(generated, 160)))
            mstore(add(data, 128), sampleIndex)
            mcopy(add(data, 160), features, 192)
            mcopy(add(data, 352), mload(add(generated, 96)), 6304)
            mstore(add(data, 6656), previousHash)
            mstore(add(data, 6688), stateHash)
            let text := mload(add(generated, 128))
            let size := mload(text)
            let padded := and(add(size, 31), not(31))
            mstore(add(data, 6720), size)
            // decodeStep's canonical encoding check proved these padding bytes zero.
            mcopy(add(data, 6752), add(text, 32), padded)
            log4(data, add(6752, padded), signature, id, sequence, identity)
        }
    }

'''
source=source[:a]+new+source[b:]
source=source.replace('''        string memory sentence;
        bool complete;''','''        // Maximum 32 validated words of 33 bytes and 31 separating spaces.
        bytes memory sentenceBuffer = new bytes(1087);
        bytes memory modelInput = new bytes(24932);
        bytes memory decoderInput = new bytes(31172);
        bytes memory stateHashBuffer = new bytes(24736);
        bytes memory eventBuffer = new bytes(6816);
        Generation memory generated;
        uint256 modelSelector = uint32(INovaModel.stepSampled.selector);
        uint256 decoderSelector = uint32(this.decodeStep.selector);
        bytes32 samplingSeed = sampleSeed;
        uint256 temperature = temperatureQ10;
        assembly ("memory-safe") {
            generated := mload(0x40)
            mstore(0x40, add(generated, 192))
            let input := add(modelInput, 32)
            mstore(input, shl(224, modelSelector))
            mcopy(add(input, 24644), features, 192)
            mstore(add(input, 24836), samplingSeed)
            mstore(add(input, 24900), temperature)
            mstore(add(decoderInput, 32), shl(224, decoderSelector))
            mstore(add(decoderInput, 36), 32)
        }
        uint256 sentenceLength;
        bool complete;''')
source=source.replace('''            Generation memory generated = _infer(c, features, state);''','''            _inferBuffered(c, state, modelInput, decoderInput, generated);''')
source=source.replace('''            c.stateHash = keccak256(abi.encode(modelHash, id, c.sequence, generated.token, generated.punct, state));
            sentence = wordIndex == 0 ? generated.text : string.concat(sentence, " ", generated.text);
            emit WordSpoken(id, c.sequence, modelHash, generated.token, generated.punct,
                generated.text, generated.terminal, sampleIndex, features, generated.scores, previousHash, c.stateHash);''','''            c.stateHash = _nextStateHash(stateHashBuffer, id, c.sequence, generated.token, generated.punct, state);
            bytes memory wordText = bytes(generated.text);
            uint256 needed = sentenceLength + wordText.length + (wordIndex == 0 ? 0 : 1);
            if (needed > 1087) revert WordRequired(4);
            assembly ("memory-safe") {
                let dest := add(add(sentenceBuffer, 32), sentenceLength)
                if wordIndex { mstore8(dest, 32) dest := add(dest, 1) }
                mcopy(dest, add(wordText, 32), mload(wordText))
            }
            sentenceLength = needed;
            _emitBufferedWord(eventBuffer, id, c, generated, sampleIndex, features, previousHash);''')
source=source.replace('''        emit SentenceSpoken(id, sentenceCount[id], firstWord, c.sequence, sentence, c.stateHash);''','''        assembly ("memory-safe") { mstore(sentenceBuffer, sentenceLength) }
        emit SentenceSpoken(id, sentenceCount[id], firstWord, c.sequence, string(sentenceBuffer), c.stateHash);''')
(p/'NovaSentenceBufferedHook.sol').write_text(source)
