// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometInterface.sol";
import "./IERC20NonStandard.sol";
import "./MerkleProof.sol";

/**
 * @title Compound's CometRewards Contract
 * @notice Hold and claim token rewards
 * @author Compound
 */

contract CometRewardsV2 {
    /**
     * @notice struct for token multiplier
     * @param token The token address
     * @param multiplier The multiplier for the token
     */
    struct TokenMultiplier {
        address token;
        uint256 multiplier;
    }

    /**
     * @notice The configuration for a reward token
     * @param multiplier The multiplier for the token
     * @param rescaleFactor The rescale factor for the token
     * @dev rescaleFactor = baseAccrualScale / tokenDecimals,
     *      so for example if baseAccrualScale = 1e18 and tokenDecimals = 1e6, rescaleFactor = 1e12
     * @param shouldUpscale Whether or not to upscale the token
     * @dev If the baseAccrualScale is greater than the tokenDecimals, we should upscale the token
     */
    struct AssetConfig {
        uint256 multiplier;
        uint128 rescaleFactor;
        bool shouldUpscale;
    }

    /**
     * @notice The configuration for a campaign
     * @param startRoot The root of the Merkle tree for the startAccrued
     * @param finishRoot The root of the Merkle tree for the finishAccrued
     * @param assets The reward tokens addresses
     * @param configs The reward tokens configurations
     * @param claimed The claimed rewards for each user
     * @param finishTimestamp The timestamp when the campaign ends
     */
    struct Campaign {
        bytes32 startRoot;
        bytes32 finishRoot;
        address[] assets;
        /// @dev token => AssetConfig
        mapping(address => AssetConfig)configs;
        /// @dev user => token => claimed
        mapping(address => mapping(address => uint256)) claimed;
        uint256 finishTimestamp;        
    }

    /**
     * @notice The reward owed to an account
     * @param token The reward token address
     * @param owed The amount of the reward token owed
     */
    struct RewardOwed {
        address token;
        uint256 owed;
    }

    /**
     * @notice The proof for a user in the start tree
     * @param startIndex The index of the user in the start tree
     * @param finishIndex The index of the user in the finish tree
     * @param startAccrued The accrued value for the user in the start tree
     * @param finishAccrued The accrued value for the user in the finish tree
     * @param startMerkleProof The Merkle proof for the start tree
     * @param finishMerkleProof The Merkle proof for the finish tree
     */
    struct Proofs {
        uint256 startIndex;
        uint256 finishIndex;
        uint256 startAccrued;
        uint256 finishAccrued;
        bytes32[] startMerkleProof;
        bytes32[] finishMerkleProof;
    }

    /**
     * @notice The proof for 2 users
     * @param proofs The proofs for each user
     */
    struct MultiProofs{
        Proofs[2] proofs;
    }

    /**
     * @notice The proof for a user in the finish tree
     * @param finishIndex The index of the user in the finish tree
     * @param finishAccrued The accrued value for the user in the finish tree
     * @param finishMerkleProof The Merkle proof for the finish tree
     */
    struct FinishProof{
        uint256 finishIndex;
        uint256 finishAccrued;
        bytes32[] finishMerkleProof;
    }

    /// @notice The governor address which controls the contract
    address public governor;
    /// @notice Campaigns per Comet instance
    /// @dev comet => Campaign[]
    mapping(address => Campaign[]) public campaigns;

    /// @notice The maximum duration for a campaign
    uint256 public constant MAX_CAMPAIGN_DURATION = 180 days;

    /// @dev The scale for factors
    uint256 internal constant FACTOR_SCALE = 1e18;

    /** Custom events **/

    event GovernorTransferred(
        address indexed oldGovernor,
        address indexed newGovernor
    );

    event RewardsClaimedSet(
        uint256 campaignId,
        address indexed user,
        address indexed comet,
        address indexed token,
        uint256 amount
    );

    event RewardClaimed(
        uint256 campaignId,
        address indexed comet,
        address indexed src,
        address indexed recipient,
        address token,
        uint256 amount
    );

    event ConfigUpdated(
        uint256 campaignId,
        address indexed comet,
        address indexed token,
        uint256 multiplier
    );

    event NewCampaign(
        address indexed comet,
        bytes32 startRoot,
        uint256 campaignId
    );

    event NewCampaignFinishRoot(
        address indexed comet,
        bytes32 finishRoot,
        uint256 campaignId
    );

    event TokenWithdrawn(
        address indexed token,
        address indexed to,
        uint256 amount
    );

    event TransferOutFailed(
        address indexed token,
        address indexed to,
        uint256 amount
    );

    /** Custom errors **/

    error BadData();
    error InvalidUint128(uint256);
    error NotPermitted(address);
    error NotSupported(address, address);
    error NullGovernor();
    error InvalidProof();
    error CampaignEnded(address, uint256);

    /**
     * @notice Construct a new rewards pool
     * @param governor_ The governor who will control the contract
     */
    constructor(address governor_) {
        if(governor_ == address(0)) revert NullGovernor();
        governor = governor_;
    }

    /**
     * @notice Adds a new campaign to a Comet with custom multipliers for each token
     * @param comet Comet protocol address
     * @param startRoot The root of the Merkle tree for the startAccrued
     * @param assets Array of reward tokens and their respective multipliers
     * @param duration The duration of the campaign in seconds, must not exceed MAX_CAMPAIGN_DURATION
     * @return campaignId Id of the created campaign
     */
    function setNewCampaignWithCustomTokenMultiplier(
        address comet,
        bytes32 startRoot,
        TokenMultiplier[] memory assets,
        uint256 duration
    ) public returns(uint256) {
        if(msg.sender != governor) revert NotPermitted(msg.sender);
        if(duration > MAX_CAMPAIGN_DURATION) revert BadData();
        if(startRoot == bytes32(0)) revert BadData();
        if(assets.length == 0) revert BadData();

        uint64 accrualScale = CometInterface(comet).baseAccrualScale();
        Campaign storage $ = campaigns[comet].push();
        uint256 campaignId = campaigns[comet].length - 1;
        $.startRoot = startRoot;
        for (uint256 i = 0; i < assets.length; i++) {
            if(assets[i].multiplier == 0) revert BadData();
            uint128 tokenScale = safe128(10 ** IERC20NonStandard(assets[i].token).decimals());

            emit ConfigUpdated(campaignId, comet, assets[i].token, assets[i].multiplier);

            if(accrualScale > tokenScale) {
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
        $.finishTimestamp = block.timestamp + duration;

        emit NewCampaign(
            comet,
            startRoot,
            campaignId
        );

        return campaignId;
    }

    /**
     * @notice Adds a new campaign to a Comet
     * @param comet The protocol instance
     * @param startRoot The root of the Merkle tree for the startAccrued
     * @param tokens The reward tokens addresses
     * @param duration The duration of the campaign in seconds, must not exceed MAX_CAMPAIGN_DURATION
     * @return campaignId Id of the created campaign
     */
    function setNewCampaign(
        address comet,
        bytes32 startRoot,
        address[] calldata tokens,
        uint256 duration
    ) external returns(uint256 campaignId) {
        TokenMultiplier[] memory assets = new TokenMultiplier[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            assets[i] = TokenMultiplier({token: tokens[i], multiplier: FACTOR_SCALE});
        }
        return setNewCampaignWithCustomTokenMultiplier(comet, startRoot, assets, duration);
    }

    /**
     * @notice Set the reward token for a Comet instance for multiple users
     * @param comet Comet protocol address
     * @param campaignId Id of the campaign
     * @param users The list of users to populate the data for
     * @param claimedAmounts The list of amounts to populate the data with
     */
    function setRewardsClaimed(
        address comet,
        uint256 campaignId,
        address[] calldata users,
        uint256[][] calldata claimedAmounts
    ) external {
        if(msg.sender != governor) revert NotPermitted(msg.sender);
        if(users.length != claimedAmounts.length) revert BadData();

        Campaign storage $ = campaigns[comet][campaignId];
        address[] storage assets = $.assets;

        for (uint256 i = 0; i < claimedAmounts.length; i++) {
            if(assets.length != claimedAmounts[i].length) revert BadData();

            for(uint256 j = 0; j < assets.length; j++){
                emit RewardsClaimedSet(campaignId, users[i], comet, assets[j], claimedAmounts[i][j]);
                $.claimed[users[i]][assets[j]] = claimedAmounts[i][j];
            }
        }
    }

    /**
     * @notice Set finish root for a campaign
     * @param comet The protocol instance
     * @param campaignId The id of the campaign
     * @param finishRoot The root of the Merkle tree for the finishAccrued
     */
    function setCampaignFinishRoot(
        address comet,
        uint256 campaignId,
        bytes32 finishRoot
    ) public {
        if(msg.sender != governor) revert NotPermitted(msg.sender);
        if(finishRoot == bytes32(0)) revert BadData();
        if(campaigns[comet].length == 0) revert NotSupported(comet, address(0));
        if(campaignId >= campaigns[comet].length) revert BadData();
        
        emit NewCampaignFinishRoot(comet, finishRoot, campaignId);
        campaigns[comet][campaignId].finishRoot = finishRoot;
    }

    /**
     * @notice Withdraw tokens from the contract
     * @param token The reward token address
     * @param to Where to send the tokens
     * @param amount The number of tokens to withdraw
     */
    function withdrawToken(address token, address to, uint256 amount) external {
        if(msg.sender != governor) revert NotPermitted(msg.sender);

        if(doTransferOut(token, to, amount) > 0)
            emit TokenWithdrawn(token, to, amount);
    }

    /**
     * @notice Transfers the governor rights to a new address
     * @param newGovernor The address of the new governor
     */
    function transferGovernor(address newGovernor) external {
        if(msg.sender != governor) revert NotPermitted(msg.sender);
        if(newGovernor == address(0)) revert NullGovernor();

        emit GovernorTransferred(governor, newGovernor);
        governor = newGovernor;
    }

    /**
     * @notice Calculates the amount of a reward token owed to an account
     * @dev This function is used to calculate the rewards owed to an account for a specific token
     * @param comet Comet protocol address
     * @param campaignId Id of the campaign
     * @param token Reward token address
     * @param account The account to check rewards for
     * @param startAccrued Start accrued value
     * @param finishAccrued Finish accrued value if finishRoot is set
     * @param shouldAccrue If true, accrues rewards before calculation if finishRoot is not set
     * @return rewardOwed A struct containing the reward token address and the amount owed
     */
    function getRewardsOwed(
        address comet,
        uint256 campaignId,
        address token,
        address account,
        uint256 startAccrued,
        uint256 finishAccrued,
        bool shouldAccrue
    ) external returns (RewardOwed memory) {        
        if(campaigns[comet].length == 0) revert NotSupported(comet, address(0));
        if(campaignId >= campaigns[comet].length) revert BadData();

        Campaign storage $ = campaigns[comet][campaignId];
        AssetConfig memory config = $.configs[token];

        if(config.multiplier == 0) revert NotSupported(comet, token);

        if($.finishRoot == bytes32(0) && shouldAccrue)
            CometInterface(comet).accrueAccount(account);
        uint256 claimed = $.claimed[account][token];
        uint256 accrued = getRewardsAccrued(
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
     * @notice Calculates the amount of each reward token owed to an account in a batch
     * @dev This function is used to calculate the rewards owed to an account for all tokens in a campaign
     * @param comet Comet protocol address
     * @param campaignId Id of the campaign
     * @param account The account to check rewards for
     * @param startAccrued Start accrued value
     * @param finishAccrued Finish accrued value if finishRoot is set
     * @param shouldAccrue If true, accrues rewards before calculation if finishRoot is not set
     * @return owed List of RewardOwed, where each entry contains a reward token address and the amount owed
     */
    function getRewardsOwedBatch(
        address comet,
        uint256 campaignId,
        address account,
        uint256 startAccrued,
        uint256 finishAccrued,
        bool shouldAccrue
    ) external returns (RewardOwed[] memory) {
        if(campaigns[comet].length == 0) revert NotSupported(comet, address(0));
        if(campaignId >= campaigns[comet].length) revert BadData();

        Campaign storage $ = campaigns[comet][campaignId];
        RewardOwed[] memory owed = new RewardOwed[]($.assets.length);

        
        if($.finishRoot == bytes32(0) && shouldAccrue)
            CometInterface(comet).accrueAccount(account);

        for (uint256 j; j < $.assets.length; j++) {
            address token = $.assets[j];
            AssetConfig memory config = $.configs[token];

            uint256 claimed = $.claimed[account][token];
            uint256 accrued = getRewardsAccrued(
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

    /**
     * @notice Claim rewards with each token from a comet instance to owner address
     *         This function is designed for users who are not included in the start Merkle root.
     *         To prove their status as new members, users must provide Merkle proofs for the two closest addresses to their own address.
     *         If the user's address is either lower than the first address or higher than the last address in the tree,
     *         the Merkle Tree includes placeholders (e.g., zero and maximum address) for comparison, ensuring there are always at least two addresses available for validation.
     *         Additionally, the Merkle Tree contains the index of each address, which serves as proof of membership for existing users.
     * @param comet Comet protocol address
     * @param campaignId Id of the campaign
     * @param src The owner to claim for
     * @param shouldAccrue Whether or not to call accrue first
     * @dev This function is designed for new members (everyone who is not in a startTree) who want to claim rewards.
     *      To prove that they are indeed new members, users need to provide evidence that verifies their status.
     *      We use a Sorted Merkle Tree for this verification process.
     *      This tree is organized based on account addresses.
     *      In order to prove that an account is new, the user must provide the Merkle proofs for the two closest addresses to their own address.
     *      If the user's address is either lower than the first address or higher than the last address in the tree,
     *      the Merkle Tree includes placeholders (zero and maximum address) for comparison, ensuring there are always at least two addresses available for comparison.
     *      Additionally, the Merkle Tree contains the index of each address, serving as proof of existing users' membership.
     * @param neighbors The neighbors of the account
     * @param proofs The Merkle proofs for each neighbor
     * @param finishProof The Merkle proof for the finish accrued if finishRoot is set
     */
    function claimForNewMember(
        address comet,
        uint256 campaignId,
        address src,
        bool shouldAccrue,
        address[2] calldata neighbors,
        Proofs[2] calldata proofs,
        FinishProof calldata finishProof
    ) external {
        if(campaigns[comet].length == 0) revert NotSupported(comet, address(0));
        verifyNewMember(comet, src, campaignId, neighbors, proofs);

        claimInternalForNewMember(
            comet,
            src,
            src,
            campaignId,
            shouldAccrue,
            finishProof
        );
    }

    /**
     * @notice Claim rewards for all chosen campaigns for given comet instance.
     *         This function is designed for users who are not included in the start Merkle root.
     *         To prove their status as new members, users must provide Merkle proofs for the two closest addresses to their own address.
     *         If the user's address is either lower than the first address or higher than the last address in the tree,
     *         the Merkle Tree includes placeholders (e.g., zero and maximum address) for comparison, ensuring there are always at least two addresses available for validation.
     *         Additionally, the Merkle Tree contains the index of each address, which serves as proof of membership for existing users.
     * @param comet Comet protocol address
     * @param campaignIds The list of campaigns to claim for
     * @param src The owner to claim for
     * @param shouldAccrue Whether or not to call accrue first
     * @param neighbors The neighbors of the account
     * @param multiProofs The Merkle proofs for each neighbor
     * @param finishProofs The Merkle proof for the finish accrued if finishRoot is set
     */
    function claimBatchForNewMember(
        address comet,
        uint256[] calldata campaignIds,
        address src,
        bool shouldAccrue,
        address[2][] calldata neighbors,
        MultiProofs[] calldata multiProofs,
        FinishProof[] calldata finishProofs
    ) external {
        if(campaignIds.length != neighbors.length) revert BadData();
        if(campaignIds.length != multiProofs.length) revert BadData();
        if(campaignIds.length != finishProofs.length) revert BadData();
        if(campaigns[comet].length == 0) revert NotSupported(comet, address(0));
        if(shouldAccrue)
            CometInterface(comet).accrueAccount(src);
        for (uint256 i; i < campaignIds.length; i++) {
            verifyNewMember(comet, src, campaignIds[i], neighbors[i], multiProofs[i].proofs);

            claimInternalForNewMember(
                comet,
                src,
                src,
                campaignIds[i],
                false,
                finishProofs[i]
            );
        }
    }

    /**
     * @notice Claim rewards with each token from a comet instance to a target address.
     *         This function is designed for users who are not included in the start Merkle root.
     *         To prove their status as new members, users must provide Merkle proofs for the two closest addresses to their own address.
     *         If the user's address is either lower than the first address or higher than the last address in the tree,
     *         the Merkle Tree includes placeholders (e.g., zero and maximum address) for comparison, ensuring there are always at least two addresses available for validation.
     *         Additionally, the Merkle Tree contains the index of each address, which serves as proof of membership for existing users.
     * @param comet Comet protocol address
     * @param campaignId Id of the campaign
     * @param src The owner to claim for
     * @param to The address to receive the rewards
     * @param shouldAccrue Whether or not to call accrue first
     * @param neighbors The neighbors of the account
     * @param proofs The Merkle proofs for each neighbor
     * @param finishProof The Merkle proof for the finish accrued if finishRoot is set
     */
    function claimToForNewMember(
        address comet,
        uint256 campaignId,
        address src,
        address to,
        bool shouldAccrue,
        address[2] calldata neighbors,
        Proofs[2] calldata proofs,
        FinishProof calldata finishProof
    ) external {
        if(campaigns[comet].length == 0) revert NotSupported(comet, address(0));
        if(!CometInterface(comet).hasPermission(src, msg.sender))
            revert NotPermitted(msg.sender);
        
        verifyNewMember(comet, src, campaignId, neighbors, proofs);

        claimInternalForNewMember(
            comet,
            src,
            to,
            campaignId,
            shouldAccrue,
            finishProof
        );
    }

    /**
    * @notice Claim rewards for all selected campaigns for a given Comet instance to a specified target address.
    *         This function is designed for users who are not included in the start Merkle root.
    *         To prove their status as new members, users must provide Merkle proofs for the two closest addresses to their own address.
    *         If the user's address is either lower than the first address or higher than the last address in the tree,
    *         the Merkle Tree includes placeholders (e.g., zero and maximum address) for comparison, ensuring there are always at least two addresses available for validation.
    *         Additionally, the Merkle Tree contains the index of each address, which serves as proof of membership for existing users.
     * @param comet Comet protocol address
     * @param campaignIds The list of campaigns to claim for
     * @param src The owner to claim for
     * @param to The address to receive the rewards
     * @param shouldAccrue Whether or not to call accrue first
     * @param neighbors The neighbors of the account
     * @param multiProofs The Merkle proofs for each neighbor
     * @param finishProofs The Merkle proof for the finish accrued if finishRoot is set
     */
    function claimToBatchForNewMember(
        address comet,
        uint256[] calldata campaignIds,
        address src,
        address to,
        bool shouldAccrue,
        address[2][] calldata neighbors,
        MultiProofs[] calldata multiProofs,
        FinishProof[] calldata finishProofs
    ) external {
        if(campaignIds.length != neighbors.length) revert BadData();
        if(campaignIds.length != multiProofs.length) revert BadData();
        if(campaignIds.length != finishProofs.length) revert BadData();
        if(campaigns[comet].length == 0) revert NotSupported(comet, address(0));
        if(shouldAccrue)
            CometInterface(comet).accrueAccount(src);
        if(!CometInterface(comet).hasPermission(src, msg.sender))
            revert NotPermitted(msg.sender);
        for (uint256 i; i < campaignIds.length; i++) {
            verifyNewMember(comet, src, campaignIds[i], neighbors[i], multiProofs[i].proofs);

            claimInternalForNewMember(
                comet,
                src,
                to,
                campaignIds[i],
                false,
                finishProofs[i]
            );
        }
    }

    /**
     * @notice Claim rewards with each token from a comet instance to the owner's address.
     *         This function allows users who are already included in the start Merkle root to claim their accumulated rewards.
     *         The function verifies the provided Merkle proofs to ensure that the user's accrued rewards are valid.
     *         If the campaign has a finishRoot set, an additional proof is required to validate the final accrued amount.
     * @param comet Comet protocol address
     * @param campaignId Id of the campaign
     * @param src The owner to claim for
     * @param shouldAccrue Whether or not to call accrue first
     * @param proofs The Merkle proofs for the start and finish accrued
     */
    function claim(
        address comet,
        uint256 campaignId,
        address src,
        bool shouldAccrue,
        Proofs calldata proofs
    ) external {
        if(campaigns[comet].length == 0) revert NotSupported(comet, address(0));

        claimInternal(comet, src, src, campaignId, proofs, shouldAccrue);
    }

    /**
     * @notice Claim rewards for all selected campaigns in a given comet instance.
     *         This function enables users to batch multiple claims in a single transaction, reducing gas costs.
     *         Each claim requires a valid Merkle proof for both the start accrued and, if applicable, the finish accrued value.
     *         Users must ensure that they provide the correct proofs for each campaign they are claiming from.
     * @param comet Comet protocol address
     * @param campaignIds The list of campaigns to claim for
     * @param src The owner to claim for
     * @param shouldAccrue Whether or not to call accrue first
     * @param proofs The Merkle proofs for the start and finish accrued
     */
    function claimBatch(
        address comet,
        uint256[] calldata campaignIds,
        address src,
        bool shouldAccrue,
        Proofs[] calldata proofs
    ) external {
        claimInternalBatch(comet, src, src, campaignIds, proofs, shouldAccrue);
    }

    /**
     * @notice Claim rewards with each token from a comet instance and send them to a specified target address.
     *         This function allows users to claim their rewards and direct them to a different address instead of their own.
     *         The function requires the caller to have permission to act on behalf of the user (`src`).
     *         As with standard claims, a valid Merkle proof must be provided to verify the rewards owed.
     * @param comet Comet protocol address
     * @param campaignId Id of the campaign
     * @param src The owner to claim for
     * @param to The address to receive the rewards
     * @param shouldAccrue Whether or not to call accrue first
     * @param proofs The Merkle proofs for the start and finish accrued
     */
    function claimTo(
        address comet,
        uint256 campaignId,
        address src,
        address to,
        bool shouldAccrue,
        Proofs calldata proofs
    ) external {
        if(!CometInterface(comet).hasPermission(src, msg.sender))
            revert NotPermitted(msg.sender);
        if(campaigns[comet].length == 0) revert NotSupported(comet, address(0));

        claimInternal(comet, src, to, campaignId, proofs, shouldAccrue);
    }

    /**
     * @notice Returns claimed rewards for a user in a specific campaign for a specific token
     * @param comet Comet protocol address
     * @param campaignId Id of the campaign
     * @param src The owner to check for
     * @param token The reward token address
     * @return The amount of claimed rewards
     */
    function rewardsClaimed(
        address comet,
        uint256 campaignId,
        address src,
        address token
    ) external view returns(uint256) {
        return campaigns[comet][campaignId].claimed[src][token];
    }

    /**
     * @notice Returns the reward configuration for all tokens in a specific campaign
     * @param comet Comet protocol address
     * @param campaignId Id of the campaign
     * @return tokens List of reward token addresses in the campaign
     * @return configs List of corresponding AssetConfig structs containing reward configurations for each token
     */
    function rewardConfig(
        address comet,
        uint256 campaignId
    ) external view returns(address[] memory, AssetConfig[] memory) {
        Campaign storage $ = campaigns[comet][campaignId];
        AssetConfig[] memory configs = new AssetConfig[]($.assets.length);
        for (uint256 i; i < $.assets.length; i++) {
            configs[i] = $.configs[$.assets[i]];
        }
        return ($.assets, configs);
    }

    /**
     * @notice Returns all campaigns for a specific Comet instance
     * @param comet Comet protocol address
     * @return startRoots The start roots for each campaign
     * @return finishRoots The finish roots for each campaign
     * @return assets The reward tokens for each campaign
     * @return finishTimestamps The finish timestamps for each campaign
     */
    function getCometCampaignsInfo(address comet) external view returns(
        bytes32[] memory startRoots,
        bytes32[] memory finishRoots,
        address[][] memory assets,
        uint256[] memory finishTimestamps
    ) {
        if(campaigns[comet].length == 0) return (startRoots, finishRoots, assets, finishTimestamps);
        startRoots = new bytes32[](campaigns[comet].length);
        finishRoots = new bytes32[](campaigns[comet].length);
        assets = new address[][](campaigns[comet].length);
        finishTimestamps = new uint256[](campaigns[comet].length);
        for (uint256 i; i < campaigns[comet].length; i++) {
            Campaign storage $ = campaigns[comet][i];
            startRoots[i] = $.startRoot;
            finishRoots[i] = $.finishRoot;
            assets[i] = $.assets;
            finishTimestamps[i] = $.finishTimestamp;
        }
    }

    /**
     * @notice Returns true if the proof is valid
     * @param root The root of the Merkle tree
     * @param proof The Merkle proof
     * @param account The account to check for
     * @param index The index of the account
     * @param accrued The accrued value for the account
     * @return True if the proof is valid
     */
    function verifyProof(
        bytes32 root,
        bytes32[] calldata proof,
        address account,
        uint256 index,
        uint256 accrued
    ) external pure returns(bool) {
        return MerkleProof.verifyCalldata(
            proof,
            root,
            keccak256(bytes.concat(keccak256(abi.encode(account, index, accrued))))
        );
    }


    /**
     * @notice Returns the reward configuration for a specific token in a specific campaign
     * @param comet Comet protocol address
     * @param campaignId Id of the campaign
     * @param token The reward token address
     * @return The reward configuration
     */
    function rewardConfigForToken(
        address comet,
        uint256 campaignId,
        address token
    ) external view returns(AssetConfig memory) {
        return campaigns[comet][campaignId].configs[token];
    }

    /**
     * @notice Claim rewards for all chosen campaigns for given comet instance to a target address
     * @param comet Comet protocol address
     * @param campaignIds The list of campaigns to claim for
     * @param src The owner to claim for
     * @param to The address to receive the rewards
     * @param shouldAccrue Whether or not to call accrue first
     * @param proofs The Merkle proofs for the start and finish accrued
     */
    function claimToBatch(
        address comet,
        uint256[] calldata campaignIds,
        address src,
        address to,
        bool shouldAccrue,
        Proofs[] calldata proofs
    ) external {
        if(!CometInterface(comet).hasPermission(src, msg.sender))
            revert NotPermitted(msg.sender);

        claimInternalBatch(comet, src, to, campaignIds, proofs, shouldAccrue);
    }

    /**
     * @dev Verify the membership of an account
     */
    function verifyNewMember(
        address comet,
        address account,
        uint256 campaignId,
        address[2] calldata neighbors,
        Proofs[2] calldata proofs
    ) internal view returns(bool) {
        // check if the account is in between the neighbors
        if(campaignId >= campaigns[comet].length) revert BadData();
        if(!(neighbors[0] < account && account < neighbors[1])) revert BadData();
        // check if the neighbors are in the right order
        if(!((proofs[1].startIndex > proofs[0].startIndex) && (proofs[1].startIndex - proofs[0].startIndex == 1))) revert BadData();

        Campaign storage $ = campaigns[comet][campaignId];

        bool isValidProof = MerkleProof.verifyCalldata(
            proofs[0].startMerkleProof,
            $.startRoot,
            keccak256(bytes.concat(keccak256(abi.encode(neighbors[0], proofs[0].startIndex, proofs[0].startAccrued)))
            )
        );

        if(!isValidProof) revert InvalidProof();

        isValidProof = MerkleProof.verifyCalldata(
            proofs[1].startMerkleProof,
            $.startRoot,
            keccak256(bytes.concat(keccak256(abi.encode(neighbors[1], proofs[1].startIndex, proofs[1].startAccrued)))
            )
        );

        if(!isValidProof) revert InvalidProof();

        return true;
    }

    /**
     * @dev Claim rewards for a new member
     */
    function claimInternalForNewMember(
        address comet,
        address src,
        address to,
        uint256 campaignId,
        bool shouldAccrue,
        FinishProof calldata finishProof
    ) internal {
        Campaign storage $ = campaigns[comet][campaignId];
        if($.finishRoot != bytes32(0)) {
            bool isValidProof = MerkleProof.verifyCalldata(
                finishProof.finishMerkleProof,
                $.finishRoot,
                keccak256(bytes.concat(keccak256(abi.encode(src, finishProof.finishIndex, finishProof.finishAccrued))))
            );

            if(!isValidProof) revert InvalidProof();
        }
        else if($.finishTimestamp < block.timestamp) revert CampaignEnded(comet, campaignId);
        if(shouldAccrue) {
            CometInterface(comet).accrueAccount(src);
        }
        for (uint256 j; j < $.assets.length; j++) {
            AssetConfig memory config = $.configs[$.assets[j]];
            address token = $.assets[j];
            uint256 claimed = $.claimed[src][token];
            uint256 accrued = getRewardsAccrued(
                comet,
                src,
                0,
                $.finishRoot != bytes32(0) ? finishProof.finishAccrued : 0,
                config
            );
            if(accrued > claimed) {
                uint256 owed = accrued - claimed;
                if(doTransferOut(token, to, owed) > 0){
                    $.claimed[src][token] = accrued;                    
                    emit RewardClaimed(campaignId, comet, src, to, token, owed);
                }
            }
        }
    }

    /**
     * @dev Claim rewards for an established member
     */
    function claimInternal(
        address comet,
        address src,
        address to,
        uint256 campaignId,
        Proofs calldata proofs,
        bool shouldAccrue
    ) internal {
        if(campaignId >= campaigns[comet].length) revert BadData();
        Campaign storage $ = campaigns[comet][campaignId];
        
        bool isValidProof = MerkleProof.verifyCalldata(
            proofs.startMerkleProof,
            $.startRoot,
            keccak256(bytes.concat(keccak256(abi.encode(src, proofs.startIndex, proofs.startAccrued))))
        );

        if(!isValidProof) revert InvalidProof();

        if($.finishRoot != bytes32(0)) {
            bool isValidProof2 = MerkleProof.verifyCalldata(
                proofs.finishMerkleProof,
                $.finishRoot,
                keccak256(bytes.concat(keccak256(abi.encode(src, proofs.finishIndex, proofs.finishAccrued))))
            );

            if(!isValidProof2) revert InvalidProof();
        }
        else if($.finishTimestamp < block.timestamp) revert CampaignEnded(comet, campaignId);
        if(shouldAccrue) {
            //remove from loop
            CometInterface(comet).accrueAccount(src);
        }
        for (uint256 j; j < $.assets.length; j++) {
            address token = $.assets[j];
            AssetConfig memory config = $.configs[token];


            uint256 claimed = $.claimed[src][token];
            uint256 accrued = getRewardsAccrued(
                comet,
                src,
                proofs.startAccrued,
                $.finishRoot != bytes32(0) ? proofs.finishAccrued : 0,
                config
            );
            if(accrued > claimed) {
                uint256 owed = accrued - claimed;
                if(doTransferOut(token, to, owed) > 0){
                    $.claimed[src][token] = accrued;                    
                    emit RewardClaimed(campaignId, comet, src, to, token, owed);
                }
            }
        }
    }

    /**
     * @dev Claim rewards for multiple campaigns
     */
    function claimInternalBatch(
        address comet,
        address src,
        address to,
        uint256[] calldata campaignIds,
        Proofs[] calldata proofs,
        bool shouldAccrue
    ) internal {
        if(campaignIds.length != proofs.length) revert BadData();
        if(campaigns[comet].length == 0) revert NotSupported(comet, address(0));
        if(shouldAccrue)
            CometInterface(comet).accrueAccount(src);
        for (uint256 i; i < campaignIds.length; i++) {
            claimInternal(
                comet,
                src,
                to,
                campaignIds[i],
                proofs[i],
                false
            );
        }
    }

    /**
     * @dev Calculate the accrued value
     */
    function getRewardsAccrued(
        address comet,
        address account,
        uint256 startAccrued, //if startAccrued = 0 => it is a new member
        uint256 finishAccrued,
        AssetConfig memory config
    ) internal view returns (uint256) {
        uint256 accrued;
        if(finishAccrued > 0) {
            accrued = finishAccrued - startAccrued;
        } else {
            accrued = CometInterface(comet).baseTrackingAccrued(account) -
                startAccrued;
        }
        if(config.shouldUpscale) {
            accrued *= config.rescaleFactor;
        } else {
            accrued /= config.rescaleFactor;
        }
        return (accrued * config.multiplier) / FACTOR_SCALE;
    }

    /**
     * @dev Safe ERC20 transfer out
     */
    function doTransferOut(address token, address to, uint256 amount) internal returns(uint256) {
        if(amount == 0) return 0;
        IERC20NonStandard(token).transfer(to, amount);
        bool success;
        assembly ("memory-safe") {
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
        if(!success){
            emit TransferOutFailed(token, to, amount);
            return 0;
        }
        else return amount;
    }

    /**
     * @dev Safe cast to uint128
     */
    function safe128(uint256 n) internal pure returns (uint128) {
        if(n > type(uint128).max) revert InvalidUint128(n);
        return uint128(n);
    }
}
