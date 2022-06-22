// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.13;

import "../Comet.sol";

/**
 * @title A modified version of Compound Comet
 * @notice This is solely used for testing upgrades
 * @author Compound
 */
contract CometModified is Comet {

    constructor(Configuration memory config) Comet(config) {}

    /**
     * @notice Initialize storage for a liquidator
     * @dev Solely used for testing upgrades
     */
    function initialize(address liquidator) external {
        liquidatorPoints[liquidator].numAbsorbs = type(uint32).max;
    }

    /**
     * @notice Calculate the amount of liquidation margin for account
     * @param account The address to check margin for
     * @return The common price quantity of liquidation margin
     */
    function getLiquidationMargin(address account) external view returns (int) {
        uint16 assetsIn = userBasic[account].assetsIn;

        int liquidity = signedMulPrice(
            presentValue(userBasic[account].principal),
            getPrice(baseTokenPriceFeed),
            uint64(baseScale)
        );

        for (uint8 i = 0; i < numAssets; i++) {
            if (isInAsset(assetsIn, i)) {
                AssetInfo memory asset = getAssetInfo(i);
                uint newAmount = mulPrice(
                    userCollateral[account][asset.asset].balance,
                    getPrice(asset.priceFeed),
                    asset.scale
                );
                liquidity += signed256(mulFactor(
                    newAmount,
                    asset.liquidateCollateralFactor
                ));
            }
        }

        return liquidity;
    }
}
