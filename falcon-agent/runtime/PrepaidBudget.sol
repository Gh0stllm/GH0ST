// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Capped requester escrow. The quote is a maximum service budget, not
/// a prediction of future network fees or a guarantee that an executor will run.
abstract contract PrepaidBudget {
    uint256 public constant CALL_GAS_CAP=31000000;
    uint256 public constant BILLING_OVERHEAD=120000;
    address constant ARB_GAS_INFO=address(0x6c);

    struct Budget {
        address owner;
        address executor;
        uint256 gasPriceCap;
        uint256 postingFeeCap;
        uint256 remainingUnits;
        uint256 remainingWei;
        uint256 spentWei;
    }
    mapping(uint256=>Budget) public budgets;
    mapping(address=>uint256) public credits;
    uint256 public totalLiability;
    bool private entered;
    bytes32 constant PAID_TX_SLOT=keccak256("GH0ST.prepaid.continuation.transaction");

    error BudgetInput();
    error FeeCapExceeded();
    error PostingFeeUnavailable();
    error PaymentFailed();
    error Reentrancy();

    event Prepaid(uint256 indexed id,address indexed owner,address indexed executor,
                  uint256 budgetWei,uint256 maximumUnits,uint256 gasPriceCap,uint256 postingFeeCap);
    event Charged(uint256 indexed id,address indexed executor,uint256 units,uint256 billedGas,
                  uint256 postingFeeWei,uint256 paymentWei,uint256 remainingWei);
    event Refunded(uint256 indexed id,address indexed owner,uint256 amountWei);
    event ExecutorChanged(uint256 indexed id,address indexed executor);
    event Withdrawn(address indexed account,address indexed recipient,uint256 amountWei);

    modifier guarded() {
        if (entered) revert Reentrancy();
        entered=true; _; entered=false;
    }

    function _budgetQuote(uint256 maximumUnits,uint256 gasPriceCap,uint256 postingFeeCap)
        internal pure returns (uint256 executionGasCap,uint256 budgetWei) {
        if (gasPriceCap==0 || gasPriceCap>1 ether || postingFeeCap>100 ether) revert BudgetInput();
        executionGasCap=maximumUnits*CALL_GAS_CAP;
        budgetWei=executionGasCap*gasPriceCap+maximumUnits*postingFeeCap;
    }

    function _fund(uint256 id,address executor,uint256 maximumUnits,uint256 gasPriceCap,
                   uint256 postingFeeCap,uint256 expectedBudgetWei) internal {
        (,uint256 required)=_budgetQuote(maximumUnits,gasPriceCap,postingFeeCap);
        if (executor==address(0) || expectedBudgetWei!=required || msg.value!=required) revert BudgetInput();
        budgets[id]=Budget(msg.sender,executor,gasPriceCap,postingFeeCap,maximumUnits,required,0);
        totalLiability+=required;
        emit Prepaid(id,msg.sender,executor,required,maximumUnits,gasPriceCap,postingFeeCap);
    }

    function _postingFee() internal view returns (uint256 fee) {
        // No silent zero fallback. Anvil tests install an explicit mock here.
        (bool ok,bytes memory data)=ARB_GAS_INFO.staticcall{gas:50000}(
            abi.encodeWithSignature("getCurrentTxL1GasFees()"));
        if (!ok || data.length!=32) revert PostingFeeUnavailable();
        fee=abi.decode(data,(uint256));
    }

    function _checkExecutor(uint256 id) internal returns (uint256 postingFee) {
        Budget storage b=budgets[id];
        if (msg.sender!=b.executor || b.remainingUnits==0) revert BudgetInput();
        if (tx.gasprice>b.gasPriceCap) revert FeeCapExceeded();
        // Posting fee belongs to the entire transaction: never bill it twice,
        // even through a smart-wallet multicall or two different sessions.
        bytes32 slot=PAID_TX_SLOT;
        bool paid;
        assembly ("memory-safe") { paid := tload(slot) tstore(slot,1) }
        if (paid) revert BudgetInput();
        postingFee=_postingFee();
        if (postingFee>b.postingFeeCap) revert FeeCapExceeded();
    }

    function _charge(uint256 id,uint256 initialGas,uint256 units,uint256 postingFee,bool done) internal {
        Budget storage b=budgets[id];
        if (units==0 || units>b.remainingUnits) revert BudgetInput();
        // A specified billing formula, NOT the final receipt's exact gasUsed.
        // Intrinsic, settlement and withdrawal work cannot be observed exactly
        // here. The fixed allowance is disclosed and the per-call cap enforced.
        uint256 billedGas=initialGas-gasleft()+BILLING_OVERHEAD;
        if (billedGas>CALL_GAS_CAP) revert FeeCapExceeded();
        uint256 payment=billedGas*tx.gasprice+postingFee;
        if (payment>b.remainingWei) revert BudgetInput();
        b.remainingUnits-=units; b.remainingWei-=payment; b.spentWei+=payment;
        credits[msg.sender]+=payment;
        emit Charged(id,msg.sender,units,billedGas,postingFee,payment,b.remainingWei);
        if (done) _refund(id);
    }

    function _refund(uint256 id) internal {
        Budget storage b=budgets[id];
        uint256 amount=b.remainingWei;
        b.remainingWei=0; b.remainingUnits=0;
        credits[b.owner]+=amount;
        emit Refunded(id,b.owner,amount);
    }

    function _setExecutor(uint256 id,address executor) internal {
        Budget storage b=budgets[id];
        if (msg.sender!=b.owner || b.remainingUnits==0 || executor==address(0)) revert BudgetInput();
        b.executor=executor; emit ExecutorChanged(id,executor);
    }

    /// @notice Pull both requester refunds and executor earnings to any recipient.
    /// No administrator, arbitrary sweep, platform fee or external payment token.
    function withdraw(address payable recipient) external guarded {
        uint256 amount=credits[msg.sender];
        if (recipient==address(0) || amount==0) revert BudgetInput();
        credits[msg.sender]=0; totalLiability-=amount;
        (bool ok,)=recipient.call{value:amount}("");
        if (!ok) revert PaymentFailed();
        emit Withdrawn(msg.sender,recipient,amount);
    }
}
