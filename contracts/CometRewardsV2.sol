// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometInterface.sol";
import "./ERC20.sol";
import "./MerkleProof.sol";

/**
 * @title Compound's CometRewards Contract
 * @notice Hold and claim token rewards
 * @author Compound
 */

contract CometRewardsV2 {
    struct TokenMultiplier {
        address token;
        uint256 multiplier;
    }

    struct AssetConfig {
        uint256 multiplier;
        uint64 rescaleFactor;
        bool shouldUpscale;
    }

    struct Compaign {
        bytes32 startRoot;
        bytes32 finishRoot;
        address[] assets;
        mapping(address => AssetConfig) configs;
        mapping(address => mapping(address => uint256)) claimed;
    }

    struct RewardOwed {
        address token;
        uint256 owed;
    }
    struct Proofs {
        uint256 startIndex;
        uint256 finishIndex;
        uint256 startAccrued;
        uint256 finishAccrued;
        bytes32[] startMerkleProof;
        bytes32[] finishMerkleProof;
    }

    struct MultiProofs{
        Proofs[2] proofs;
    }

    struct FinisProof{
        uint256 finishIndex;
        uint256 finishAccrued;
        bytes32[] finishMerkleProof;
    }

    /// @notice The governor address which controls the contract
    address public governor;
    mapping(address => Compaign[]) public compaigns;

    /// @dev The scale for factors
    uint256 internal constant FACTOR_SCALE = 1e18;

    /** Custom events **/

    event GovernorTransferred(
        address indexed oldGovernor,
        address indexed newGovernor
    );

    event RewardsClaimedSet(
        address indexed user,
        address indexed comet,
        address indexed token,
        uint256 amount
    );

    event RewardClaimed(
        address indexed src,
        address indexed recipient,
        address indexed token,
        uint256 amount
    );

    event ConfigUpdated(
        address indexed comet,
        address indexed token,
        uint256 multiplier
    );

    event NewCampaign(
        address comet,
        uint256 campaignId
    );

    /** Custom errors **/

    error BadData();
    error InmultiplieridUInt64(uint256);
    error NotPermitted(address);
    error NotSupported(address, address);
    error TransferOutFailed(address, uint256);
    error NullGovernor();
    error InvalidProof();
    error NotANewMember(address);
    error CompaignEnded(address, uint256);

    /**
     * @notice Construct a new rewards pool
     * @param governor_ The governor who will control the contract
     */
    constructor(address governor_) {
        if (governor_ == address(0)) revert NullGovernor();
        governor = governor_;
    }

    function setCompaignExt(
        address comet,
        bytes32 startRoot,
        TokenMultiplier[] memory assets
    ) public returns(uint256 compaignId) {
        if (msg.sender != governor) revert NotPermitted(msg.sender);
        if (startRoot == bytes32(0)) revert BadData();

        uint64 accrualScale = CometInterface(comet).baseAccrualScale();
        Compaign storage $ = compaigns[comet].push();
        $.startRoot = startRoot;
        for (uint256 i = 0; i < assets.length; i++) {
            uint64 tokenScale = safe64(10 ** ERC20(assets[i].token).decimals());

            emit ConfigUpdated(comet, assets[i].token, assets[i].multiplier);

            if (accrualScale > tokenScale) {
                $.configs[assets[i].token] = AssetConfig({
                    multiplier: assets[i].multiplier,
                    rescaleFactor: accrualScale / tokenScale,
                    shouldUpscale: false
                });
            } else {
                $.configs[assets[i].token] = AssetConfig({
                    multiplier: assets[i].multiplier,
                    rescaleFactor: tokenScale / accrualScale,
                    shouldUpscale: true
                });
            }

            $.assets.push(assets[i].token);
        }

        emit NewCampaign(
            comet,
            $.assets.length - 1
        );

        return($.assets.length - 1);
    }

    /**
     * @notice Set the reward token for a Comet instance
     * @param comet The protocol instance
     * @param startRoot The root of the Mercle tree for the startAccrued multiplierues
     * @param tokens The reward tokens addresses
     */
    function setCompaign(
        address comet,
        bytes32 startRoot,
        address[] calldata tokens
    ) external returns(uint256 compaignId) {
        TokenMultiplier[] memory assets = new TokenMultiplier[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            assets[i] = TokenMultiplier({token: tokens[i], multiplier: FACTOR_SCALE});
        }
        return setCompaignExt(comet, startRoot, assets);
    }

    /**
     * @notice Set the rewards claimed for a list of users
     * @param comet The protocol instance to populate the data for
     * @param compaignId The id of the compaign
     * @param users The list of users to populate the data for
     * @param claimedAmounts The list of claimed amounts for each token to populate the data with
     */
    function setRewardsClaimed(
        address comet,
        uint256 compaignId,
        address[] calldata users,
        address[][] calldata tokens,
        uint256[][] calldata claimedAmounts
    ) external {
        if (msg.sender != governor) revert NotPermitted(msg.sender);
        if (users.length != claimedAmounts.length) revert BadData();
        if (tokens.length != claimedAmounts.length) revert BadData();

        Compaign storage $ = compaigns[comet][compaignId];

        for (uint256 i = 0; i < claimedAmounts.length; i++) {
            if ($.assets.length != claimedAmounts[i].length) revert BadData();
            if ($.assets.length != tokens[i].length) revert BadData();
            for(uint256 j = 0; j < claimedAmounts[i].length; j++){
                emit RewardsClaimedSet(users[i], comet, tokens[i][j], claimedAmounts[i][j]);
                $.claimed[users[i]][tokens[i][j]] = claimedAmounts[i][j];
            }
        }
    }

    /**
     * @notice Set the reward token for a Comet instance
     * @param comet The protocol instance
     * @param compaignId The id of the campaign
     * @param finishRoot The root of the Mercle tree for the finishAccrued multiplierues
     */
    function setCompaignFinish(
        address comet,
        bytes32 finishRoot,
        uint256 compaignId
    ) public {
        if (msg.sender != governor) revert NotPermitted(msg.sender);
        if (finishRoot == bytes32(0)) revert BadData();
        
        compaigns[comet][compaignId].finishRoot = finishRoot;
    }

    /**
     * @notice Withdraw tokens from the contract
     * @param token The reward token address
     * @param to Where to send the tokens
     * @param amount The number of tokens to withdraw
     */
    function withdrawToken(address token, address to, uint256 amount) external {
        if (msg.sender != governor) revert NotPermitted(msg.sender);

        doTransferOut(token, to, amount);
    }

    /**
     * @notice Transfers the governor rights to a new address
     * @param newGovernor The address of the new governor
     */
    function transferGovernor(address newGovernor) external {
        if (msg.sender != governor) revert NotPermitted(msg.sender);
        if (newGovernor == address(0)) revert NullGovernor();

        emit GovernorTransferred(governor, newGovernor);
        governor = newGovernor;
    }

    /**
     * @notice Calculates the amount of a reward token owed to an account
     * @param comet The protocol instance
     * @param account The account to check rewards for
     */
    function getRewardOwed(
        address comet,
        uint256 compaignId,
        address token,
        address account,
        uint256 startAccrued,
        uint256 finishAccrued
    ) external returns (RewardOwed memory) {        
        if (compaigns[comet].length == 0) revert NotSupported(comet, address(0));
        if(compaignId >= compaigns[comet].length) revert BadData();

        Compaign storage $ = compaigns[comet][compaignId];
        AssetConfig memory config = $.configs[token];

        if (config.multiplier == 0) revert NotSupported(comet, token);

        CometInterface(comet).accrueAccount(account);
        uint256 claimed = $.claimed[account][token];
        uint256 accrued = getRewardAccrued(
                comet,
                account,
                startAccrued,
                finishAccrued,
                config
            );

        return RewardOwed(
            token,
            accrued > claimed ? accrued - claimed : 0
        );
    }

    /**
     * @notice Calculates the amount of a reward token owed to an account
     * @param comet The protocol instance
     * @param account The account to check rewards for
     */
    function getRewardOwedBatch(
        address comet,
        uint256 compaignId,
        address account,
        uint256 startAccrued,
        uint256 finishAccrued
    ) external returns (RewardOwed[] memory) {
        if (compaigns[comet].length == 0) revert NotSupported(comet, address(0));
        if(compaignId >= compaigns[comet].length) revert BadData();

        Compaign storage $ = compaigns[comet][compaignId];
        RewardOwed[] memory owed = new RewardOwed[]($.assets.length);

        for (uint256 j; j < $.assets.length; j++) {
            address token = $.assets[j];
            AssetConfig memory config = $.configs[token];

            uint256 claimed = $.claimed[account][token];
            CometInterface(comet).accrueAccount(account);
            uint256 accrued = getRewardAccrued(
                comet,
                account,
                startAccrued,
                finishAccrued,
                config
            );

            owed[j] = RewardOwed(
                token,
                accrued > claimed ? accrued - claimed : 0
            );
        }

        return owed;
    }

    function claimForNewMember(
        address comet,
        uint256 compaignId,
        address src,
        bool shouldAccrue,
        address[2] calldata neighbors,
        Proofs[2] calldata proofs,
        FinisProof calldata finishProof
    ) external {
        verifyMembership(comet, src, compaignId, neighbors, proofs);

        claimInternalForNewMember(
            comet,
            src,
            src,
            compaignId,
            shouldAccrue,
            finishProof
        );
    }

    function claimBatchForNewMember(
        address comet,
        uint256[] memory compaignIDs,
        address src,
        bool shouldAccrue,
        address[2][] calldata neighbors,
        MultiProofs[] calldata multiProofs,
        FinisProof[] calldata finishProof
    ) external {
        if (compaignIDs.length != neighbors.length) revert BadData();
        if (compaignIDs.length != multiProofs.length) revert BadData();
        for (uint256 i; i < compaignIDs.length; i++) {
            verifyMembership(comet, src, compaignIDs[i], neighbors[i], multiProofs[i].proofs);

            claimInternalForNewMember(
                comet,
                src,
                src,
                compaignIDs[i],
                shouldAccrue,
                finishProof[i]
            );
        }
    }

    function claimToForNewMember(
        address comet,
        uint256 compaignId,
        address src,
        address to,
        bool shouldAccrue,
        address[2] calldata neighbors,
        Proofs[2] calldata proofs,
        FinisProof calldata finishProof
    ) external {
        if(!CometInterface(comet).hasPermission(src, msg.sender))
            revert NotPermitted(msg.sender);
        
        verifyMembership(comet, src, compaignId, neighbors, proofs);

        claimInternalForNewMember(
            comet,
            src,
            to,
            compaignId,
            shouldAccrue,
            finishProof
        );
    }

    function claimToBatchForNewMember(
        address comet,
        uint256[] memory compaignIDs,
        address src,
        address to,
        bool shouldAccrue,
        address[2][] calldata neighbors,
        MultiProofs[] calldata multiProofs,
        FinisProof[] calldata finishProof
    ) external {
        if (compaignIDs.length != neighbors.length) revert BadData();
        if (compaignIDs.length != multiProofs.length) revert BadData();
        for (uint256 i; i < compaignIDs.length; i++) {
            if(!CometInterface(comet).hasPermission(src, msg.sender))
                revert NotPermitted(msg.sender);
            
            verifyMembership(comet, src, compaignIDs[i], neighbors[i], multiProofs[i].proofs);

            claimInternalForNewMember(
                comet,
                src,
                to,
                compaignIDs[i],
                shouldAccrue,
                finishProof[i]
            );
        }
    }

    /**
     * @notice Claim rewards of token type from a comet instance to owner address
     * @param comet The protocol instance
     * @param src The owner to claim for
     * @param shouldAccrue Whether or not to call accrue first
     */
    function claim(
        address comet,
        uint256 compaingId,
        address src,
        bool shouldAccrue,
        Proofs calldata proofs
    ) external {
        claimInternal(comet, src, src, compaingId, proofs, shouldAccrue);
    }

    function claimBatch(
        address comet,
        uint256[] memory compaingIDs,
        address src,
        bool shouldAccrue,
        Proofs[] calldata proofs
    ) external {
        claimInternalBatch(comet, src, src, compaingIDs, proofs, shouldAccrue);
    }

    /**
     * @notice Claim rewards of token type from a comet instance to a target address
     * @param comet The protocol instance
     * @param src The owner to claim for
     * @param to The address to receive the rewards
     */
    function claimTo(
        address comet,
        uint256 compaingId,
        address src,
        address to,
        bool shouldAccrue,
        Proofs calldata proofs
    ) external {
        if (!CometInterface(comet).hasPermission(src, msg.sender))
            revert NotPermitted(msg.sender);

        claimInternal(comet, src, to, compaingId, proofs, shouldAccrue);
    }

    function rewardsClaimed(
        address comet,
        uint256 compaignId,
        address src,
        address token
    ) external view returns(uint256) {
        return compaigns[comet][compaignId].claimed[src][token];
    }

    function rewardConfig(
        address comet,
        uint256 compaignId,
        address token
    ) external view returns(AssetConfig memory) {
        return compaigns[comet][compaignId].configs[token];
    }

    /**
     * @notice Claim rewards of token type from a comet instance to a target address
     * @param comet The protocol instance
     * @param src The owner to claim for
     * @param to The address to receive the rewards
     */
    function claimToBatch(
        address comet,
        uint256[] memory compaingIDs,
        address src,
        address to,
        bool shouldAccrue,
        Proofs[] calldata proofs
    ) external {
        if (!CometInterface(comet).hasPermission(src, msg.sender))
            revert NotPermitted(msg.sender);

        claimInternalBatch(comet, src, to, compaingIDs, proofs, shouldAccrue);
    }

    function verifyMembership(
        address comet,
        address account,
        uint256 compaignId,
        address[2] calldata neighbors,
        Proofs[2] calldata proofs
    ) internal view returns(bool) {
        if(!(neighbors[0] < account && account < neighbors[1])) revert BadData();
        if(!((proofs[1].startIndex > proofs[0].startIndex) && (proofs[1].startIndex - proofs[0].startIndex == 1))) revert BadData();
        if (compaigns[comet].length == 0) revert NotSupported(comet, address(0));
        if(compaignId >= compaigns[comet].length) revert BadData();

        Compaign storage $ = compaigns[comet][compaignId];

        bool isValidProof = MerkleProof.verifyCalldata(
            proofs[0].startMerkleProof,
            $.startRoot,
            keccak256(bytes.concat(keccak256(abi.encode(neighbors[0], proofs[0].startIndex, proofs[0].startAccrued)))
            )
        );

        if (!isValidProof) revert InvalidProof();

        isValidProof = MerkleProof.verifyCalldata(
            proofs[1].startMerkleProof,
            $.startRoot,
            keccak256(bytes.concat(keccak256(abi.encode(neighbors[1], proofs[1].startIndex, proofs[1].startAccrued)))
            )
        );

        if (!isValidProof) revert InvalidProof();

        return true;
    }

    function claimInternalForNewMember(
        address comet,
        address src,
        address to,
        uint256 compaignId, //add array support
        bool shouldAccrue,
        FinisProof calldata finishProof
    ) internal {
        Compaign storage $ = compaigns[comet][compaignId];
        if ($.finishRoot != bytes32(0)) {
            bool isValidProof = MerkleProof.verifyCalldata(
                finishProof.finishMerkleProof,
                $.finishRoot,
                keccak256(bytes.concat(keccak256(abi.encode(src, finishProof.finishIndex, finishProof.finishAccrued))))
            );

            if (!isValidProof) revert InvalidProof();
        }
        if (shouldAccrue) {
            //remove from loop
            CometInterface(comet).accrueAccount(src);
        }
        for (uint256 j; j < $.assets.length; j++) {
            AssetConfig memory config = $.configs[$.assets[j]];
            address token = $.assets[j];
            uint256 claimed = $.claimed[src][token];
            uint256 accrued;
            if($.finishRoot == bytes32(0))
            {
                accrued = CometInterface(comet).baseTrackingAccrued(src);
                if (config.shouldUpscale) {
                    accrued *= config.rescaleFactor;
                } else {
                    accrued /= config.rescaleFactor;
                }
                accrued = (accrued * config.multiplier) / FACTOR_SCALE;
            }
            else{
                accrued = getRewardAccrued(
                    comet,
                    src,
                    0,
                    finishProof.finishAccrued,
                    config
                );
            }
            if (accrued > claimed) {
                uint256 owed = accrued - claimed;
                $.claimed[src][token] = accrued;
                doTransferOut(token, to, owed);

                emit RewardClaimed(src, to, token, owed);
            }
        }
    }

    function claimInternal(
        address comet,
        address src,
        address to,
        uint256 compaignId, //add array support
        Proofs calldata proofs,
        bool shouldAccrue
    ) internal {
        if (compaigns[comet].length == 0) revert NotSupported(comet, address(0));
        if(compaignId >= compaigns[comet].length) revert BadData();
        Compaign storage $ = compaigns[comet][compaignId];
        
        bool isValidProof = MerkleProof.verifyCalldata(
            proofs.startMerkleProof,
            $.startRoot,
            keccak256(bytes.concat(keccak256(abi.encode(src, proofs.startIndex, proofs.startAccrued))))
        );

        if (!isValidProof) revert InvalidProof();

        if ($.finishRoot != bytes32(0)) {
            bool isValidProof2 = MerkleProof.verifyCalldata(
                proofs.finishMerkleProof,
                $.finishRoot,
                keccak256(bytes.concat(keccak256(abi.encode(src, proofs.finishIndex, proofs.finishAccrued))))
            );

            if (!isValidProof2) revert InvalidProof();
        }
        if (shouldAccrue) {
            //remove from loop
            CometInterface(comet).accrueAccount(src);
        }
        for (uint256 j; j < $.assets.length; j++) {
            address token = $.assets[j];
            AssetConfig memory config = $.configs[token];


            uint256 claimed = $.claimed[src][token];
            uint256 accrued = getRewardAccrued(
                comet,
                src,
                proofs.startAccrued,
                proofs.finishAccrued,
                config
            );

            if (accrued > claimed) {
                uint256 owed = accrued - claimed;
                $.claimed[src][token] = accrued;
                doTransferOut(token, to, owed);

                emit RewardClaimed(src, to, token, owed);
            }
        }
    }

    function claimInternalBatch(
        address comet,
        address src,
        address to,
        uint256[] memory compaingIds, //add array support
        Proofs[] calldata proofs,
        bool shouldAccrue
    ) internal {
        if (compaingIds.length != proofs.length) revert BadData();
        if(compaigns[comet].length == 0) revert NotSupported(comet, address(0));
        for (uint256 i; i < compaingIds.length; i++) {
            if(compaingIds[i] >= compaigns[comet].length) revert BadData();
            claimInternal(
                comet,
                src,
                to,
                compaingIds[i],
                proofs[i],
                shouldAccrue
            );
        }
    }

    function getRewardAccrued(
        address comet,
        address account,
        uint256 startAccrued, //if startAccrued = 0 => it new member
        uint256 finishAccrued,
        AssetConfig memory config
    ) internal view returns (uint256 accrued) {
        if(finishAccrued > 0){
            accrued = finishAccrued - startAccrued;
        }
         else{
            accrued = CometInterface(comet).baseTrackingAccrued(account) -
                startAccrued;
        }
        if (config.shouldUpscale) {
            accrued *= config.rescaleFactor;
        } else {
            accrued /= config.rescaleFactor;
        }
        return (accrued * config.multiplier) / FACTOR_SCALE;
    }

    /**
     * @dev Safe ERC20 transfer out
     */
    function doTransferOut(address token, address to, uint256 amount) internal {
        bool success = ERC20(token).transfer(to, amount);
        if (!success) revert TransferOutFailed(to, amount);
    }

    /**
     * @dev Safe cast to uint64
     */
    function safe64(uint256 n) internal pure returns (uint64) {
        if (n > type(uint64).max) revert InmultiplieridUInt64(n);
        return uint64(n);
    }
}
