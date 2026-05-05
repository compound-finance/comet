// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

/// @notice Minimal slice of Compound v3's Comet interface needed by
/// `OrchestratorRouter`. Pulls in only the functions we touch — `supplyTo`
/// for the router-mediated supply path. Direct `withdraw` doesn't need a
/// router (target=comet), so it's not declared here.
interface IComet {
    function supplyTo(address dst, address asset, uint256 amount) external;
    function baseToken() external view returns (address);
}
