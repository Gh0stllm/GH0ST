// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IPrepaidRuntime {
    function advancePrepaid(uint256,uint256) external returns (uint256);
    function withdraw(address payable) external;
}

/// @dev Local adversarial caller only. Not part of deployment or runtime bytecode.
contract PaymentProbe {
    IPrepaidRuntime private target;
    bool public secondCallRejected;
    bool public reentryRejected;

    function doubleAdvance(address runtime,uint256 first,uint256 second) external {
        target=IPrepaidRuntime(runtime);
        target.advancePrepaid(first,1);
        try target.advancePrepaid(second,1) { revert("double charge accepted"); }
        catch { secondCallRejected=true; }
    }

    function takeCredit() external { target.withdraw(payable(address(this))); }

    receive() external payable {
        try target.withdraw(payable(address(this))) { revert("reentry accepted"); }
        catch { reentryRejected=true; }
    }
}
