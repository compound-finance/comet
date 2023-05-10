import { diff as jestDiff } from 'jest-diff';
import { diff } from 'deep-object-diff';
import { BigNumber, Contract } from 'ethers';

export async function diffState(
  contract: Contract,
  getState: (c: Contract, blockNumber?: number) => Promise<object>,
  oldBlockNumber: number,
  newBlockNumber?: number
): Promise<object> {
  const toBigInt = n => (BigNumber.isBigNumber(n) ? n.toBigInt() : n);
  const oldState = mapObject(await getState(contract, oldBlockNumber), toBigInt);
  const newState = mapObject(await getState(contract, newBlockNumber), toBigInt);

  // Informational log (can also generate a report if we think is valuable)
  console.log('State changes after migration');
  console.log(
    jestDiff(newState, oldState, {
      aAnnotation: 'New state',
      aIndicator: '+',
      bAnnotation: 'Old state',
      bIndicator: '-'
    })
  );

  return diff(oldState, newState);
}

export async function getCometConfig(comet: Contract, blockNumber?: number): Promise<object> {
  const blockTag = { blockTag: blockNumber === undefined ? 'latest' : blockNumber };
  const numAssets = await comet.numAssets(blockTag);
  const config = {
    governor: await comet.governor(blockTag),
    pauseGuardian: await comet.pauseGuardian(blockTag),
    baseToken: await comet.baseToken(blockTag),
    baseTokenPriceFeed: await comet.baseTokenPriceFeed(blockTag),
    extensionDelegate: await comet.extensionDelegate(blockTag),
    supplyKink: await comet.supplyKink(blockTag),
    supplyPerSecondRateSlopeLow: await comet.supplyPerSecondInterestRateSlopeLow(blockTag),
    supplyPerSecondInterestRateSlopeHigh: await comet.supplyPerSecondInterestRateSlopeHigh(
      blockTag
    ),
    supplyPerSecondInterestRateBase: await comet.supplyPerSecondInterestRateBase(blockTag),
    borrowKink: await comet.borrowKink(blockTag),
    borrowPerSecondInterestRateSlopeLow: await comet.borrowPerSecondInterestRateSlopeLow(blockTag),
    borrowPerSecondInterestRateSlopeHigh: await comet.borrowPerSecondInterestRateSlopeHigh(
      blockTag
    ),
    borrowPerSecondInterestRateBase: await comet.borrowPerSecondInterestRateBase(blockTag),
    storeFrontPriceFactor: await comet.storeFrontPriceFactor(blockTag),
    baseTrackingSupplySpeed: await comet.baseTrackingSupplySpeed(blockTag),
    baseTrackingBorrowSpeed: await comet.baseTrackingBorrowSpeed(blockTag),
    baseMinForRewards: await comet.baseMinForRewards(blockTag),
    baseBorrowMin: await comet.baseBorrowMin(blockTag),
    targetReserves: await comet.targetReserves(blockTag),
    numAssets
  };
  for (let i = 0; i < numAssets; i++) {
    const assetInfo = await comet.getAssetInfo(i, blockTag);
    const asset = new Contract(
      assetInfo.asset,
      ['function symbol() external view returns (string memory)'],
      comet.provider
    );
    const symbol = await asset.symbol(blockTag);
    config[symbol] = {
      offset: assetInfo.offset,
      asset: assetInfo.asset,
      priceFeed: assetInfo.priceFeed,
      scale: assetInfo.scale,
      borrowCollateralFactor: assetInfo.borrowCollateralFactor,
      liquidateCollateralFactor: assetInfo.liquidateCollateralFactor,
      liquidationFactor: assetInfo.liquidationFactor,
      supplyCap: assetInfo.supplyCap
    };
  }
  return config;
}

function mapObject(obj: object, mapFn: (x) => any) {
  Object.keys(obj).forEach(key => {
    const value = obj[key];
    const newValue = mapFn(value);
    if (value !== newValue) {
      obj[key] = newValue;
    } else if (typeof value === 'object') {
      mapObject(value, mapFn);
    }
  });
  return obj;
}
