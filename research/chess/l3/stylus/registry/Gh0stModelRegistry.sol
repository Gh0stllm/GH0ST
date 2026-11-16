// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// Immutable paged model bytes. Integrity prototype; no inference or deployment assumed.
contract Gh0stModelRegistry {
    uint64 public constant MAX_MODEL_BYTES = 64 * 1024 * 1024 * 1024;
    uint32 public constant MAX_PAGES = 1 << 20;
    uint32 public constant MIN_PAGE_BYTES = 256;
    uint32 public constant MAX_PAGE_BYTES = 65536;

    struct Model {
        address owner;
        bytes32 root;
        bytes32 declaredFileSHA256;
        uint64 totalBytes;
        uint32 pageBytes;
        uint32 pageCount;
        uint32 uploadedPages;
        uint8 treeHeight;
        bool isSealed;
    }
    mapping(bytes32 => Model) public models;
    mapping(bytes32 => mapping(uint32 => bytes)) private data;
    mapping(bytes32 => mapping(uint32 => bool)) public uploaded;
    mapping(bytes32 => mapping(uint32 => bytes32)) public pageHashes;
    event ModelRegistered(bytes32 indexed modelId, address indexed owner, bytes32 root, uint64 totalBytes, uint32 pageBytes, uint32 pageCount, bytes32 declaredFileSHA256);
    event PageStored(bytes32 indexed modelId, uint32 indexed index, bytes32 leaf);
    event ModelSealed(bytes32 indexed modelId);

    function modelId(address owner, bytes32 root, uint64 totalBytes, uint32 pageBytes, bytes32 fileSHA256) public pure returns (bytes32) {
        return keccak256(abi.encode("GH0ST_MODEL_V1", owner, root, totalBytes, pageBytes, fileSHA256));
    }
    function registerModel(uint64 totalBytes, uint32 pageBytes, bytes32 root, bytes32 fileSHA256) external returns (bytes32 id) {
        require(totalBytes != 0 && totalBytes <= MAX_MODEL_BYTES, "model size");
        require(pageBytes >= MIN_PAGE_BYTES && pageBytes <= MAX_PAGE_BYTES && (pageBytes & (pageBytes - 1)) == 0, "page size");
        require(root != bytes32(0) && fileSHA256 != bytes32(0), "missing commitment");
        uint64 count64 = (totalBytes + pageBytes - 1) / pageBytes;
        require(count64 <= MAX_PAGES, "page count");
        uint32 count = uint32(count64);
        id = modelId(msg.sender, root, totalBytes, pageBytes, fileSHA256);
        if (models[id].owner != address(0)) return id;
        uint8 height;
        for (uint32 n = count - 1; n != 0; n >>= 1) height++;
        models[id] = Model(msg.sender, root, fileSHA256, totalBytes, pageBytes, count, 0, height, false);
        emit ModelRegistered(id, msg.sender, root, totalBytes, pageBytes, count, fileSHA256);
    }
    function leafHash(uint32 index, bytes memory page) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(bytes1(0x00), index, uint32(page.length), page));
    }
    function nodeHash(bytes32 left, bytes32 right) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(bytes1(0x01), left, right));
    }
    function emptyLeaf() public pure returns (bytes32) {
        return keccak256(hex"02");
    }
    function uploadPage(bytes32 id, uint32 index, bytes calldata page, bytes32[] calldata proof) external returns (bool changed) {
        Model storage m = models[id];
        require(m.owner != address(0) && m.owner == msg.sender, "not model owner");
        require(index < m.pageCount, "page index");
        uint64 start = uint64(index) * m.pageBytes;
        uint64 expected = index == m.pageCount - 1 ? m.totalBytes - start : m.pageBytes;
        require(page.length == expected, "page length");
        bytes32 leaf = leafHash(index, page);
        if (uploaded[id][index]) {
            require(pageHashes[id][index] == leaf, "conflicting page");
            return false;
        }
        require(!m.isSealed, "model sealed");
        require(proof.length == m.treeHeight, "proof length");
        bytes32 hash = leaf;
        bytes32 zero = emptyLeaf();
        for (uint256 level = 0; level < proof.length; level++) {
            uint256 position = uint256(index) >> level;
            // The last real page's right siblings cover every padding subtree.
            // Canonical zero subtrees prevent an owner sealing an arbitrary padding root.
            if (index == m.pageCount - 1 && (position & 1) == 0) {
                uint256 siblingStart = (position + 1) << level;
                if (siblingStart >= m.pageCount) require(proof[level] == zero, "noncanonical padding");
            }
            hash = (position & 1) == 0 ? nodeHash(hash, proof[level]) : nodeHash(proof[level], hash);
            zero = nodeHash(zero, zero);
        }
        require(hash == m.root, "invalid page proof");
        uploaded[id][index] = true;
        pageHashes[id][index] = leaf;
        data[id][index] = page;
        m.uploadedPages++;
        emit PageStored(id, index, leaf);
        return true;
    }
    function sealModel(bytes32 id) external returns (bool changed) {
        Model storage m = models[id];
        require(m.owner != address(0) && m.owner == msg.sender, "not model owner");
        if (m.isSealed) return false;
        require(m.uploadedPages == m.pageCount, "missing pages");
        m.isSealed = true;
        emit ModelSealed(id);
        return true;
    }
    function getPage(bytes32 id, uint32 index) external view returns (bytes memory) {
        Model storage m = models[id];
        require(m.isSealed, "not sealed");
        require(index < m.pageCount, "page index");
        return data[id][index];
    }
}
