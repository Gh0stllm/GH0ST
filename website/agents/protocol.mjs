export const quoteTypes = {
  Quote: [
    ["requester", "address"],
    ["passportId", "uint256"],
    ["promptHash", "bytes32"],
    ["maxTokens", "uint32"],
    ["fee", "uint256"],
    ["validUntil", "uint64"],
    ["deadline", "uint64"],
    ["nonce", "bytes32"],
  ].map(([name, type]) => ({ name, type })),
};
export const tokenQuoteTypes = {
  TokenQuote: [
    { name: "request", type: "Quote" },
    { name: "paymentToken", type: "address" },
  ],
  Quote: quoteTypes.Quote,
};
export const resultTypes = {
  InferenceResult: [
    ["requestId", "bytes32"],
    ["promptHash", "bytes32"],
    ["modelId", "bytes32"],
    ["artifactHash", "bytes32"],
    ["answerHash", "bytes32"],
    ["inputTokens", "uint64"],
    ["outputTokens", "uint64"],
    ["modelCycles", "uint128"],
  ].map(([name, type]) => ({ name, type })),
};
export const quoteDomain = (address) => ({
  name: "GH0ST BNB Access",
  version: "1",
  chainId: 56,
  verifyingContract: address,
});
export const resultDomain = (address) => ({
  name: "GH0ST ICP Inference",
  version: "1",
  chainId: 4663,
  verifyingContract: address,
});
export const transportPrompt = (address, id, prompt) =>
  `GH0ST_ACCESS_V1|56|${address.toLowerCase()}|${id.toLowerCase()}\n${prompt}`;
export const passportAbi = [
  "function agentRegistry() view returns(address)",
  "function mint(uint256 agentId) returns(uint256)",
  "function passportOf(address) view returns(uint256)",
  "function agentIdOf(uint256) view returns(uint256)",
  "function isActive(address) view returns(bool)",
  "function tokenURI(uint256) view returns(string)",
  "function totalSupply() view returns(uint256)",
  "event PassportMinted(uint256 indexed passportId,address indexed holder,uint256 indexed agentId)",
];
export const requestTuple =
  "(address requester,uint256 passportId,uint256 fee,uint32 maxTokens,uint64 deadline,uint8 status,bytes32 promptHash,bytes32 transportPromptHash,bytes32 originRequestId,bytes32 answerHash)";
export const quoteTuple =
  "(address requester,uint256 passportId,bytes32 promptHash,uint32 maxTokens,uint256 fee,uint64 validUntil,uint64 deadline,bytes32 nonce)";
export const resultTuple =
  "(bytes32 requestId,bytes32 promptHash,bytes32 modelId,bytes32 artifactHash,bytes32 answerHash,uint64 inputTokens,uint64 outputTokens,uint128 modelCycles)";
export const accessAbi = [
  `function requestThoughtWithToken(string prompt,(${quoteTuple} request,address paymentToken) tokenQuote,bytes signature) returns(bytes32)`,
  `function tokenQuoteDigest((${quoteTuple} request,address paymentToken) tokenQuote) view returns(bytes32)`,
  "function bindPaymentToken(address)",
  "function paymentToken() view returns(address)",
  "function requestPaymentToken(bytes32) view returns(address)",
  "function tokenCredits(address) view returns(uint256)",
  "function tokenEscrowed() view returns(uint256)",
  "function totalTokenCredits() view returns(uint256)",
  "function withdrawToken()",
  `function requestThought(string prompt,${quoteTuple} quote,bytes signature) payable returns(bytes32)`,
  `function requests(bytes32) view returns${requestTuple}`,
  `function fulfill(bytes32 requestId,${resultTuple} result,string answer,bytes signature)`,
  `function quoteDigest(${quoteTuple} quote) view returns(bytes32)`,
  "function passport() view returns(address)",
  "function quoteSigner() view returns(address)",
  "function treasury() view returns(address)",
  "function icpSigner() view returns(address)",
  "function rhGateway() view returns(address)",
  "function modelId() view returns(bytes32)",
  "function artifactHash() view returns(bytes32)",
  "function paused() view returns(bool)",
  "function credits(address) view returns(uint256)",
  "function requestPage(uint256,uint256,uint256) view returns(bytes32[])",
  "function requestCount(uint256) view returns(uint256)",
  "function completed(uint256) view returns(uint256)",
  "function rewarded(uint256) view returns(uint256)",
  "function rewardPool() view returns(uint256)",
  "function rewardPerRequest() view returns(uint256)",
  "function maxRewardsPerPassport() view returns(uint256)",
  "function maxRewardBudget() view returns(uint256)",
  "function fundRewards() payable",
  "function withdraw()",
  "function refund(bytes32)",
  "event ThoughtRequested(bytes32 indexed requestId,uint256 indexed passportId,address indexed requester,bytes32 transportPromptHash,uint32 maxTokens,uint64 deadline,uint256 fee,string prompt,string transportPrompt)",
  "event ThoughtFulfilled(bytes32 indexed requestId,bytes32 indexed originRequestId,uint256 indexed passportId,bytes32 answerHash,string answer,uint64 inputTokens,uint64 outputTokens,uint128 modelCycles)",
];
export const originAbi = [
  "function requestInference(string prompt,uint32 maxTokens,uint64 deadline) returns(bytes32)",
  "function requests(bytes32) view returns(address requester,uint32 maxTokens,uint64 deadline,uint8 status,bytes32 promptHash,bytes32 answerHash)",
  "function authorizedRequester(address) view returns(bool)",
  "function icpSigner() view returns(address)",
  "function modelId() view returns(bytes32)",
  "function artifactHash() view returns(bytes32)",
  `function fulfillInference(${resultTuple} result,string answer,bytes signature)`,
  "event InferenceRequested(bytes32 indexed requestId,address indexed requester,bytes32 indexed modelId,bytes32 promptHash,uint32 maxTokens,uint64 deadline,string prompt)",
  "event InferenceFulfilled(bytes32 indexed requestId,bytes32 indexed answerHash,string answer,uint64 inputTokens,uint64 outputTokens,uint128 modelCycles)",
];
