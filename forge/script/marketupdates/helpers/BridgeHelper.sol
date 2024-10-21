// SPDX-License-Identifier: MIT
pragma solidity ^0.8.15;

import "./MarketUpdateAddresses.sol";
import "./ChainAddresses.sol";
import "./GovernanceHelper.sol";
import "@comet-contracts/bridges/BaseBridgeReceiver.sol";
import "@comet-contracts/bridges/arbitrum/ArbitrumBridgeReceiver.sol";
import "@comet-contracts/bridges/optimism/OptimismBridgeReceiver.sol";
import "@comet-contracts/bridges/optimism/IOvmL2CrossDomainMessengerInterface.sol";
import "@comet-contracts/bridges/polygon/PolygonBridgeReceiver.sol";
import "@comet-contracts/bridges/scroll/ScrollBridgeReceiver.sol";
import "@comet-contracts/bridges/scroll/IScrollMessenger.sol";
import "@comet-contracts/bridges/arbitrum/AddressAliasHelper.sol";
import "@comet-contracts/ITimelock.sol";

library BridgeHelper {

    function simulateMessageAndExecuteProposal(
        Vm vm,
        ChainAddresses.Chain chain,
        address messageSender,
        GovernanceHelper.ProposalRequest memory proposalRequest
    ) external {
        bytes memory l2Payload = abi.encode(
            proposalRequest.targets,
            proposalRequest.values,
            proposalRequest.signatures,
            proposalRequest.calldatas
        );

        if (chain == ChainAddresses.Chain.ARBITRUM) {
            ArbitrumBridgeReceiver arbitrumBridgeReceiver = ArbitrumBridgeReceiver(payable(ChainAddresses.ARBITRUM_BRIDGE_RECEIVER));

            // Simulate message to receiver
            address l2Address = AddressAliasHelper.applyL1ToL2Alias(messageSender);
            vm.prank(l2Address);
            address(arbitrumBridgeReceiver).call(l2Payload);

            // Advance timestamp and execute proposal
            uint256 delay = ITimelock(ChainAddresses.ARBITRUM_LOCAL_TIMELOCK).delay();
            vm.warp(block.timestamp + delay + 10);
            uint256 proposalId = arbitrumBridgeReceiver.proposalCount();
            arbitrumBridgeReceiver.executeProposal(proposalId);

        } else if (chain == ChainAddresses.Chain.OPTIMISM || chain == ChainAddresses.Chain.BASE) {
            // Common setup for Optimism and Base
            address crossDomainMessenger = 0x4200000000000000000000000000000000000007;
            vm.prank(crossDomainMessenger);
            address crossDomainMessengerImpl = 0xC0d3c0d3c0D3c0D3C0d3C0D3C0D3c0d3c0d30007;

            // Mock message sender
            vm.mockCall(
                crossDomainMessengerImpl,
                abi.encodeWithSelector(IOvmL2CrossDomainMessengerInterface.xDomainMessageSender.selector),
                abi.encode(messageSender)
            );

            if (chain == ChainAddresses.Chain.OPTIMISM) {
                OptimismBridgeReceiver optimismBridgeReceiver = OptimismBridgeReceiver(payable(ChainAddresses.OPTIMISM_BRIDGE_RECEIVER));

                address(optimismBridgeReceiver).call(l2Payload);

                uint256 delay = ITimelock(ChainAddresses.OPTIMISM_LOCAL_TIMELOCK).delay();
                vm.warp(block.timestamp + delay + 10);
                uint256 proposalId = optimismBridgeReceiver.proposalCount();
                optimismBridgeReceiver.executeProposal(proposalId);

            } else {
                // For Base chain
                BaseBridgeReceiver baseBridgeReceiver = BaseBridgeReceiver(payable(ChainAddresses.BASE_BRIDGE_RECEIVER));

                address(baseBridgeReceiver).call(l2Payload);

                uint256 delay = ITimelock(ChainAddresses.BASE_LOCAL_TIMELOCK).delay();
                vm.warp(block.timestamp + delay + 10);
                uint256 proposalId = baseBridgeReceiver.proposalCount();
                baseBridgeReceiver.executeProposal(proposalId);
            }

        } else if (chain == ChainAddresses.Chain.POLYGON) {
            PolygonBridgeReceiver polygonBridgeReceiver = PolygonBridgeReceiver(payable(ChainAddresses.POLYGON_BRIDGE_RECEIVER));

            address fxChild = 0x8397259c983751DAf40400790063935a11afa28a;
            vm.prank(fxChild);
            polygonBridgeReceiver.processMessageFromRoot(
                1,
                MarketUpdateAddresses.GOVERNOR_BRAVO_TIMELOCK_ADDRESS,
                l2Payload
            );

            uint256 delay = ITimelock(ChainAddresses.POLYGON_LOCAL_TIMELOCK).delay();
            vm.warp(block.timestamp + delay + 10);
            uint256 proposalId = polygonBridgeReceiver.proposalCount();
            polygonBridgeReceiver.executeProposal(proposalId);

        } else if (chain == ChainAddresses.Chain.SCROLL) {
            ScrollBridgeReceiver scrollBridgeReceiver = ScrollBridgeReceiver(payable(ChainAddresses.SCROLL_BRIDGE_RECEIVER));

            address l2Messenger = 0x781e90f1c8Fc4611c9b7497C3B47F99Ef6969CbC;
            vm.prank(l2Messenger);

            // Mock message sender
            vm.mockCall(
                l2Messenger,
                abi.encodeWithSelector(IScrollMessenger.xDomainMessageSender.selector),
                abi.encode(messageSender)
            );

            address(scrollBridgeReceiver).call(l2Payload);

            uint256 delay = ITimelock(ChainAddresses.SCROLL_LOCAL_TIMELOCK).delay();
            vm.warp(block.timestamp + delay + 10);
            uint256 proposalId = scrollBridgeReceiver.proposalCount();
            scrollBridgeReceiver.executeProposal(proposalId);
        }
    }
}
