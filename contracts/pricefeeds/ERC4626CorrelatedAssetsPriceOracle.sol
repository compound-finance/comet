// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../IERC4626.sol";
import { PriceCapAdapterBase } from "./utils/PriceCapAdapterBase.sol";

/**
 * @title ERC4626CorrelatedAssetsPriceOracle
 * @author Compound
 */
contract ERC4626CorrelatedAssetsPriceOracle is PriceCapAdapterBase {
  /**
   * @param capAdapterParams parameters to create cap adapter
   */
  constructor(
    CapAdapterParams memory capAdapterParams
  )
    PriceCapAdapterBase(
      CapAdapterBaseParams({
        manager: capAdapterParams.manager,
        baseAggregatorAddress: capAdapterParams.baseAggregatorAddress,
        ratioProviderAddress: capAdapterParams.ratioProviderAddress,
        description: capAdapterParams.description,
        ratioDecimals: capAdapterParams.ratioDecimals,
        priceFeedDecimals: capAdapterParams.priceFeedDecimals,
        minimumSnapshotDelay: capAdapterParams.minimumSnapshotDelay,
        priceCapParams: capAdapterParams.priceCapParams
      })
    )
  {}

  /**
   * @notice Returns the current exchange ratio of lst to the underlying(base) asset
   */
  function getRatio() public view override returns (int256) {
    return int256(IERC4626(RATIO_PROVIDER).convertToAssets(10 ** RATIO_DECIMALS));
  }
}
