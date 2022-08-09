import { AssetConfigStruct } from '../../build/types/Comet';
import { ProtocolConfiguration } from './index';
import { ContractMap } from '../../plugins/deployment_manager/ContractMap';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import { ethers } from 'ethers';

function address(a: string): string {
  if (!a.match(/^0x[a-fA-F0-9]{40}$/)) {
    throw new Error(`expected address, got \`${a}\``);
  }
  return a;
}

function floor(n: number): bigint {
  return BigInt(Math.floor(n));
}

function number(n: number): bigint {
  return floor(Number(n));
}

function percentage(n: number, checkRange: boolean = true): bigint {
  if (checkRange) {
    if (n > 1.0) {
      throw new Error(`percentage greater than 100% [received=${n}]`);
    } else if (n < 0) {
      throw new Error(`percentage less than 0% [received=${n}]`);
    }
  }
  return floor(n * 1e18);
}

interface NetworkRateConfiguration {
  supplyKink: number;
  supplySlopeLow: number;
  supplySlopeHigh: number;
  supplyBase: number;
  borrowKink: number;
  borrowSlopeLow: number;
  borrowSlopeHigh: number;
  borrowBase: number;
}

interface NetworkTrackingConfiguration {
  indexScale: number;
  baseSupplySpeed: number;
  baseBorrowSpeed: number;
  baseMinForRewards: number;
}

interface NetworkAssetConfiguration {
  address?: string;
  priceFeed: string;
  decimals: number;
  borrowCF: number;
  liquidateCF: number;
  liquidationFactor: number;
  supplyCap: number;
}

interface NetworkConfiguration {
  name: string;
  symbol: string;
  governor?: string;
  pauseGuardian?: string;
  baseToken: string;
  baseTokenAddress?: string;
  baseTokenPriceFeed: string;
  borrowMin: number;
  storeFrontPriceFactor: number;
  targetReserves: number;
  rates: NetworkRateConfiguration;
  tracking: NetworkTrackingConfiguration;
  assets: { [name: string]: NetworkAssetConfiguration };
  rewardToken?: string;
  rewardTokenAddress?: string;
}

function getContractAddress(contractName: string, contracts: ContractMap, fallbackAddress?: string): string {
  let contract = contracts.get(contractName);
  if (!contract) {
    if (fallbackAddress) return fallbackAddress;
    throw new Error(
      `Cannot find contract \`${contractName}\` in contract map with keys \`${JSON.stringify(
        [...contracts.keys()]
      )}\``
    );
  }
  return contract.address;
}

function getAssetConfigs(
  assets: { [name: string]: NetworkAssetConfiguration },
  contracts: ContractMap,
): AssetConfigStruct[] {
  return Object.entries(assets).map(([assetName, assetConfig]) => ({
    asset: getContractAddress(assetName, contracts, assetConfig.address),
    priceFeed: address(assetConfig.priceFeed),
    decimals: number(assetConfig.decimals),
    borrowCollateralFactor: percentage(assetConfig.borrowCF),
    liquidateCollateralFactor: percentage(assetConfig.liquidateCF),
    liquidationFactor: percentage(assetConfig.liquidationFactor),
    supplyCap: number(assetConfig.supplyCap), // TODO: Decimals
  }));
}

function getOverridesOrConfig(
  overrides: ProtocolConfiguration,
  config: NetworkConfiguration,
  contracts: ContractMap,
): ProtocolConfiguration {
  const interestRateInfoMapping = (rates) => ({
    supplyKink: _ => percentage(rates.supplyKink),
    supplyPerYearInterestRateSlopeLow: _ => percentage(rates.supplySlopeLow),
    supplyPerYearInterestRateSlopeHigh: _ => percentage(rates.supplySlopeHigh),
    supplyPerYearInterestRateBase: _ => percentage(rates.supplyBase),
    borrowKink: _ => percentage(rates.borrowKink),
    borrowPerYearInterestRateSlopeLow: _ => percentage(rates.borrowSlopeLow),
    borrowPerYearInterestRateSlopeHigh: _ => percentage(rates.borrowSlopeHigh),
    borrowPerYearInterestRateBase: _ => percentage(rates.borrowBase),
  });
  const trackingInfoMapping = (tracking) => ({
    trackingIndexScale: _ => number(tracking.indexScale),
    baseTrackingSupplySpeed: _ => number(tracking.baseSupplySpeed),
    baseTrackingBorrowSpeed: _ => number(tracking.baseBorrowSpeed),
    baseMinForRewards: _ => number(tracking.baseMinForRewards),
  });
  const mapping = () => ({
    name: _ => config.name,
    symbol: _ => config.symbol,
    governor: _ => config.governor ? address(config.governor) : getContractAddress('timelock', contracts),
    pauseGuardian: _ => config.pauseGuardian ? address(config.pauseGuardian) : getContractAddress('timelock', contracts),
    baseToken: _ => getContractAddress(config.baseToken, contracts, config.baseTokenAddress),
    baseTokenPriceFeed: _ => address(config.baseTokenPriceFeed),
    baseBorrowMin: _ => number(config.borrowMin), // TODO: in token units (?)
    storeFrontPriceFactor: _ => percentage(config.storeFrontPriceFactor),
    targetReserves: _ => number(config.targetReserves),
    ...interestRateInfoMapping(config.rates),
    ...trackingInfoMapping(config.tracking),
    assetConfigs: _ => getAssetConfigs(config.assets, contracts),
    rewardTokenAddress: _ => (config.rewardToken || config.rewardTokenAddress) ?
      getContractAddress(config.rewardToken, contracts, config.rewardTokenAddress) :
      ethers.constants.AddressZero,
  });
  return Object.entries(mapping()).reduce((acc, [k, f]) => {
    return { [k]: overrides[k] ?? f(config), ...acc };
  }, {});
}

export async function getConfiguration(
  deploymentManager: DeploymentManager,
  configOverrides: ProtocolConfiguration = {},
): Promise<ProtocolConfiguration> {
  const config = await deploymentManager.readConfig<NetworkConfiguration>();
  const contracts = await deploymentManager.contracts();
  return getOverridesOrConfig(configOverrides, config, contracts);
}
