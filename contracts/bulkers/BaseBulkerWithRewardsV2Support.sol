// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../CometInterface.sol";
import "../IERC20NonStandard.sol";
import "../IWETH9.sol";

/**
 * @dev Interface for claiming rewards from the CometRewards contract
 */
interface IClaimableV2 {
    // v1
    function claim(address comet, address src, bool shouldAccrue) external;

    function claimTo(address comet, address src, address to, bool shouldAccrue) external;

    // v2
    struct Proofs {
        uint256 startIndex;
        uint256 finishIndex;
        uint256 startAccrued;
        uint256 finishAccrued;
        bytes32[] startMerkleProof;
        bytes32[] finishMerkleProof;
    }

    struct FinishProof{
        uint256 finishIndex;
        uint256 finishAccrued;
        bytes32[] finishMerkleProof;
    }

    struct MultiProofs{
        Proofs[2] proofs;
    }

    function claimForNewMember(
        address comet,
        uint256 campaignId,
        address src,
        bool shouldAccrue,
        address[2] calldata neighbors,
        Proofs[2] calldata proofs,
        FinishProof calldata finishProof
    ) external;

    function claimToForNewMember(
        address comet,
        uint256 campaignId,
        address src,
        address to,
        bool shouldAccrue,
        address[2] calldata neighbors,
        Proofs[2] calldata proofs,
        FinishProof calldata finishProof
    ) external;

    function claim(
        address comet,
        uint256 campaignId,
        address src,
        bool shouldAccrue,
        Proofs calldata proofs
    ) external;

    function claimTo(
        address comet,
        uint256 campaignId,
        address src,
        address to,
        bool shouldAccrue,
        Proofs calldata proofs
    ) external;
}

/**
 * @title Compound's Bulker contract
 * @notice Executes multiple Comet-related actions in a single transaction
 * @author Compound
 * @dev Note: Only intended to be used on EVM chains that have a native token and wrapped native token that implements the IWETH interface
 */
contract BaseBulkerWithRewardsV2Support {
    address public x;
    /** Custom events **/

    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    /** General configuration constants **/

    /// @notice The admin of the Bulker contract
    address public admin;

    /// @notice The address of the wrapped representation of the chain's native asset
    address payable public immutable wrappedNativeToken;

    /** Actions **/

    /// @notice The action for supplying an asset to Comet
    bytes32 public constant ACTION_SUPPLY_ASSET = "ACTION_SUPPLY_ASSET";

    /// @notice The action for supplying a native asset (e.g. ETH on Ethereum mainnet) to Comet
    bytes32 public constant ACTION_SUPPLY_NATIVE_TOKEN = "ACTION_SUPPLY_NATIVE_TOKEN";

    /// @notice The action for transferring an asset within Comet
    bytes32 public constant ACTION_TRANSFER_ASSET = "ACTION_TRANSFER_ASSET";

    /// @notice The action for withdrawing an asset from Comet
    bytes32 public constant ACTION_WITHDRAW_ASSET = "ACTION_WITHDRAW_ASSET";

    /// @notice The action for withdrawing a native asset from Comet
    bytes32 public constant ACTION_WITHDRAW_NATIVE_TOKEN = "ACTION_WITHDRAW_NATIVE_TOKEN";

    /// @notice The action for claiming rewards from the Comet rewards contract
    bytes32 public constant ACTION_CLAIM_REWARD = "ACTION_CLAIM_REWARD";

    /// @notice The action for claiming rewards from the Comet rewards contract (v2)
    bytes32 public constant ACTION_CLAIM_REWARD_V2 = "ACTION_CLAIM_REWARD_V2";

    /// @notice The action for claiming rewards from the Comet rewards contract (v2) with a new member
    /// @dev Shortened to 32 symbols due to the 32 byte limit of the bytes32 type
    bytes32 public constant ACTION_CLAIM_REWARD_V2_NEW_MEMBER = "ACTION_CLAIM_V2_NEW_MEMBER";

    /** Custom errors **/

    error InvalidAddress();
    error InvalidArgument();
    error FailedToSendNativeToken();
    error TransferInFailed();
    error TransferOutFailed();
    error Unauthorized();
    error UnhandledAction();

    /**
     * @notice Construct a new BaseBulker instance
     * @param admin_ The admin of the Bulker contract
     * @param wrappedNativeToken_ The address of the wrapped representation of the chain's native asset
     **/
    constructor(address admin_, address payable wrappedNativeToken_) {
        admin = admin_;
        wrappedNativeToken = wrappedNativeToken_;
    }

    /**
     * @notice Fallback for receiving native token. Needed for ACTION_WITHDRAW_NATIVE_TOKEN
     */
    receive() external payable {}

    /**
     * @notice A public function to sweep accidental ERC-20 transfers to this contract
     * @dev Note: Make sure to check that the asset being swept out is not malicious
     * @param recipient The address that will receive the swept funds
     * @param asset The address of the ERC-20 token to sweep
     */
    function sweepToken(address recipient, address asset) external {
        if (msg.sender != admin) revert Unauthorized();

        uint256 balance = IERC20NonStandard(asset).balanceOf(address(this));
        doTransferOut(asset, recipient, balance);
    }

    /**
     * @notice A public function to sweep accidental native token transfers to this contract
     * @param recipient The address that will receive the swept funds
     */
    function sweepNativeToken(address recipient) external {
        if (msg.sender != admin) revert Unauthorized();

        uint256 balance = address(this).balance;
        (bool success, ) = recipient.call{ value: balance }("");
        if (!success) revert FailedToSendNativeToken();
    }

    /**
     * @notice Transfers the admin rights to a new address
     * @param newAdmin The address that will become the new admin
     */
    function transferAdmin(address newAdmin) external {
        if (msg.sender != admin) revert Unauthorized();
        if (newAdmin == address(0)) revert InvalidAddress();

        address oldAdmin = admin;
        admin = newAdmin;
        emit AdminTransferred(oldAdmin, newAdmin);
    }

    /**
     * @notice Executes a list of actions in order
     * @param actions The list of actions to execute in order
     * @param data The list of calldata to use for each action
     */
    function invoke(bytes32[] calldata actions, bytes[] calldata data) external payable {
        if (actions.length != data.length) revert InvalidArgument();

        uint unusedNativeToken = msg.value;
        for (uint i = 0; i < actions.length; ) {
            bytes32 action = actions[i];
            if (action == ACTION_SUPPLY_ASSET) {
                (address comet, address to, address asset, uint amount) = abi.decode(data[i], (address, address, address, uint));
                supplyTo(comet, to, asset, amount);
            } else if (action == ACTION_SUPPLY_NATIVE_TOKEN) {
                (address comet, address to, uint amount) = abi.decode(data[i], (address, address, uint));
                uint256 nativeTokenUsed = supplyNativeTokenTo(comet, to, amount);
                unusedNativeToken -= nativeTokenUsed;
            } else if (action == ACTION_TRANSFER_ASSET) {
                (address comet, address to, address asset, uint amount) = abi.decode(data[i], (address, address, address, uint));
                transferTo(comet, to, asset, amount);
            } else if (action == ACTION_WITHDRAW_ASSET) {
                (address comet, address to, address asset, uint amount) = abi.decode(data[i], (address, address, address, uint));
                withdrawTo(comet, to, asset, amount);
            } else if (action == ACTION_WITHDRAW_NATIVE_TOKEN) {
                (address comet, address to, uint amount) = abi.decode(data[i], (address, address, uint));
                withdrawNativeTokenTo(comet, to, amount);
            } else if (action == ACTION_CLAIM_REWARD) {
                (address comet, address rewards, address src, bool shouldAccrue) = abi.decode(data[i], (address, address, address, bool));
                claimReward(comet, rewards, src, shouldAccrue);
            } else if (action == ACTION_CLAIM_REWARD_V2) {
                (
                    address comet,
                    address rewards,
                    uint256 campaignId,
                    address src,
                    bool shouldAccrue,
                    IClaimableV2.Proofs memory proofs
                ) = abi.decode(data[i], (address, address, uint256, address, bool, IClaimableV2.Proofs));
                claimRewardV2(comet, rewards, campaignId, src, shouldAccrue, proofs);
            } else if (action == ACTION_CLAIM_REWARD_V2_NEW_MEMBER) {
                (
                    address comet,
                    address rewards,
                    uint256 campaignId,
                    address src,
                    bool shouldAccrue,
                    address[2] memory neighborsMemory,
                    IClaimableV2.Proofs[2] memory proofsMemory,
                    IClaimableV2.FinishProof memory finishProofMemory
                ) = abi.decode(data[i], (address, address, uint256, address, bool, address[2], IClaimableV2.Proofs[2], IClaimableV2.FinishProof));
                claimRewardV2ForNewMember(
                    comet,
                    rewards,
                    campaignId,
                    src,
                    shouldAccrue,
                    neighborsMemory,
                    proofsMemory,
                    finishProofMemory
                );
            }
            else {
                handleAction(action, data[i]);
            }
            unchecked { i++; }
        }

        // Refund unused native token back to msg.sender
        if (unusedNativeToken > 0) {
            (bool success, ) = msg.sender.call{ value: unusedNativeToken }("");
            if (!success) revert FailedToSendNativeToken();
        }
    }

    /**
     * @notice Handles any actions not handled by the BaseBulker implementation
     * @dev Note: Meant to be overridden by contracts that extend BaseBulker and want to support more actions
     */
    function handleAction(bytes32 action, bytes calldata data) virtual internal {
        revert UnhandledAction();
    }

    /**
     * @notice Supplies an asset to a user in Comet
     * @dev Note: This contract must have permission to manage msg.sender's Comet account
     */
    function supplyTo(address comet, address to, address asset, uint amount) internal {
        CometInterface(comet).supplyFrom(msg.sender, to, asset, amount);
    }

    /**
     * @notice Wraps the native token and supplies wrapped native token to a user in Comet
     * @return The amount of the native token wrapped and supplied to Comet
     * @dev Note: Supports `amount` of `uint256.max` implies max only for base asset
     */
    function supplyNativeTokenTo(address comet, address to, uint amount) internal returns (uint256) {
        uint256 supplyAmount = amount;
        if (wrappedNativeToken == CometInterface(comet).baseToken()) {
            if (amount == type(uint256).max)
                supplyAmount = CometInterface(comet).borrowBalanceOf(msg.sender);
        }
        IWETH9(wrappedNativeToken).deposit{ value: supplyAmount }();
        IWETH9(wrappedNativeToken).approve(comet, supplyAmount);
        CometInterface(comet).supplyFrom(address(this), to, wrappedNativeToken, supplyAmount);
        return supplyAmount;
    }

    /**
     * @notice Transfers an asset to a user in Comet
     * @dev Note: This contract must have permission to manage msg.sender's Comet account
     */
    function transferTo(address comet, address to, address asset, uint amount) internal {
        CometInterface(comet).transferAssetFrom(msg.sender, to, asset, amount);
    }

    /**
     * @notice Withdraws an asset to a user in Comet
     * @dev Note: This contract must have permission to manage msg.sender's Comet account
     */
    function withdrawTo(address comet, address to, address asset, uint amount) internal {
        CometInterface(comet).withdrawFrom(msg.sender, to, asset, amount);
    }

    /**
     * @notice Withdraws wrapped native token from Comet, unwraps it to the native token, and transfers it to a user
     * @dev Note: This contract must have permission to manage msg.sender's Comet account
     * @dev Note: Supports `amount` of `uint256.max` only for the base asset. Should revert for a collateral asset
     */
    function withdrawNativeTokenTo(address comet, address to, uint amount) internal {
        uint256 withdrawAmount = amount;
        if (wrappedNativeToken == CometInterface(comet).baseToken()) {
            if (amount == type(uint256).max)
                withdrawAmount = CometInterface(comet).balanceOf(msg.sender);
        }
        CometInterface(comet).withdrawFrom(msg.sender, address(this), wrappedNativeToken, withdrawAmount);
        IWETH9(wrappedNativeToken).withdraw(withdrawAmount);
        (bool success, ) = to.call{ value: withdrawAmount }("");
        if (!success) revert FailedToSendNativeToken();
    }

    /**
     * @notice Claims rewards for a user
     */
    function claimReward(address comet, address rewards, address src, bool shouldAccrue) internal {
        IClaimableV2(rewards).claim(comet, src, shouldAccrue);
    }

    /**
     * @notice Claims rewards from the Comet rewards contract (v2)
     */
    function claimRewardV2(address comet, address rewards, uint256 campaignId, address src, bool shouldAccrue, IClaimableV2.Proofs memory proofs) internal {
        IClaimableV2(rewards).claim(comet, campaignId, src, shouldAccrue, proofs);
    }

    /**
     * @notice Claims rewards from the Comet rewards contract (v2) for a new member
     */
    function claimRewardV2ForNewMember(
        address comet,
        address rewards,
        uint256 campaignId,
        address src,
        bool shouldAccrue,
        address[2] memory neighbors,
        IClaimableV2.Proofs[2] memory proofs,
        IClaimableV2.FinishProof memory finishProof
    ) internal {
        IClaimableV2(rewards).claimForNewMember(comet, campaignId, src, shouldAccrue, neighbors, proofs, finishProof);
    }


    /**
     * @notice Similar to ERC-20 transfer, except it properly handles `transferFrom` from non-standard ERC-20 tokens
     * @param asset The ERC-20 token to transfer in
     * @param from The address to transfer from
     * @param amount The amount of the token to transfer
     * @dev Note: This does not check that the amount transferred in is actually equals to the amount specified (e.g. fee tokens will not revert)
     * @dev Note: This wrapper safely handles non-standard ERC-20 tokens that do not return a value. See here: https://medium.com/coinmonks/missing-return-value-bug-at-least-130-tokens-affected-d67bf08521ca
     */
    function doTransferIn(address asset, address from, uint amount) internal {
        IERC20NonStandard(asset).transferFrom(from, address(this), amount);

        bool success;
        assembly {
            switch returndatasize()
                case 0 {                       // This is a non-standard ERC-20
                    success := not(0)          // set success to true
                }
                case 32 {                      // This is a compliant ERC-20
                    returndatacopy(0, 0, 32)
                    success := mload(0)        // Set `success = returndata` of override external call
                }
                default {                      // This is an excessively non-compliant ERC-20, revert.
                    revert(0, 0)
                }
        }
        if (!success) revert TransferInFailed();
    }

    /**
     * @notice Similar to ERC-20 transfer, except it properly handles `transfer` from non-standard ERC-20 tokens
     * @param asset The ERC-20 token to transfer out
     * @param to The recipient of the token transfer
     * @param amount The amount of the token to transfer
     * @dev Note: This wrapper safely handles non-standard ERC-20 tokens that do not return a value. See here: https://medium.com/coinmonks/missing-return-value-bug-at-least-130-tokens-affected-d67bf08521ca
     */
    function doTransferOut(address asset, address to, uint amount) internal {
        IERC20NonStandard(asset).transfer(to, amount);

        bool success;
        assembly {
            switch returndatasize()
                case 0 {                      // This is a non-standard ERC-20
                    success := not(0)         // set success to true
                }
                case 32 {                     // This is a compliant ERC-20
                    returndatacopy(0, 0, 32)
                    success := mload(0)       // Set `success = returndata` of override external call
                }
                default {                     // This is an excessively non-compliant ERC-20, revert.
                    revert(0, 0)
                }
        }
        if (!success) revert TransferOutFailed();
    }
}
