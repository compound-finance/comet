import { AssetConfigStruct } from '../../build/types/Comet';
import { ConfigurationStruct } from '../../build/types/Configurator';
import { ProtocolConfiguration } from './index';
import { ContractMap } from '../../plugins/deployment_manager/ContractMap';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';

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

// Note: Expects a string in scientific notation format (e.g. 1000e18 or 1_000e18)
function stringToBigInt(x: ScientificNotation) {
  if (typeof x !== 'string') {
    throw new Error(`expected argument to be string, got ${x}`);
  }
  const sanitizedInput = x.replace(/_/g, '');
  if (!sanitizedInput.match(/^[0-9]+([.][0-9]+)?e[0-9]+$/)) {
    throw new Error(`expected string in scientific notation form, got ${x}`);
  }

  const nums = sanitizedInput.split('e');
  const coefficient = Number(nums[0]);
  const exponent = Number(nums[1]);
  // If exponent is a decimal, then just convert it directly using `number()`.
  // Note: This does mean we could lose some precision when using a decimal coefficient
  if (!Number.isInteger(coefficient)) {
    return number(Number(sanitizedInput));
  } else {
    return BigInt(coefficient) * (10n ** BigInt(exponent));
  }
}

type ScientificNotation = string;

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
  indexScale: ScientificNotation;
  baseSupplySpeed: ScientificNotation;
  baseBorrowSpeed: ScientificNotation;
  baseMinForRewards: ScientificNotation;
}

interface NetworkAssetConfiguration {
  address?: string;
  priceFeed: string;
  decimals: number;
  borrowCF: number;
  liquidateCF: number;
  liquidationFactor: number;
  supplyCap: ScientificNotation;
}

export interface NetworkConfiguration {
  name: string;
  symbol: string;
  governor?: string;
  pauseGuardian?: string;
  baseToken: string;
  baseTokenAddress?: string;
  baseTokenPriceFeed: string;
  borrowMin: ScientificNotation;
  storeFrontPriceFactor: number;
  targetReserves: ScientificNotation;
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
    priceFeed: getContractAddress(`${assetName}:priceFeed`, contracts, assetConfig.priceFeed),
    decimals: number(assetConfig.decimals),
    borrowCollateralFactor: percentage(assetConfig.borrowCF),
    liquidateCollateralFactor: percentage(assetConfig.liquidateCF),
    liquidationFactor: percentage(assetConfig.liquidationFactor),
    supplyCap: stringToBigInt(assetConfig.supplyCap),
  }));
}

function getOverridesOrConfig(
  overrides: ProtocolConfiguration,
  config: NetworkConfiguration,
  contracts: ContractMap,
): ProtocolConfiguration {
  const interestRateInfoMapping = (rates: NetworkRateConfiguration) => ({
    supplyKink: _ => percentage(rates.supplyKink),
    supplyPerYearInterestRateSlopeLow: _ => percentage(rates.supplySlopeLow),
    supplyPerYearInterestRateSlopeHigh: _ => percentage(rates.supplySlopeHigh, false),
    supplyPerYearInterestRateBase: _ => percentage(rates.supplyBase),
    borrowKink: _ => percentage(rates.borrowKink),
    borrowPerYearInterestRateSlopeLow: _ => percentage(rates.borrowSlopeLow),
    borrowPerYearInterestRateSlopeHigh: _ => percentage(rates.borrowSlopeHigh, false),
    borrowPerYearInterestRateBase: _ => percentage(rates.borrowBase),
  });
  const trackingInfoMapping = (tracking: NetworkTrackingConfiguration) => ({
    trackingIndexScale: _ => stringToBigInt(tracking.indexScale),
    baseTrackingSupplySpeed: _ => stringToBigInt(tracking.baseSupplySpeed),
    baseTrackingBorrowSpeed: _ => stringToBigInt(tracking.baseBorrowSpeed),
    baseMinForRewards: _ => stringToBigInt(tracking.baseMinForRewards),
  });
  const mapping = () => ({
    name: _ => config.name,
    symbol: _ => config.symbol,
    governor: _ => config.governor ? address(config.governor) : getContractAddress('timelock', contracts),
    pauseGuardian: _ => config.pauseGuardian ? address(config.pauseGuardian) : getContractAddress('timelock', contracts),
    baseToken: _ => getContractAddress(config.baseToken, contracts, config.baseTokenAddress),
    baseTokenPriceFeed: _ => getContractAddress(`${config.baseToken}:priceFeed`, contracts, config.baseTokenPriceFeed),
    baseBorrowMin: _ => stringToBigInt(config.borrowMin),
    storeFrontPriceFactor: _ => percentage(config.storeFrontPriceFactor),
    targetReserves: _ => stringToBigInt(config.targetReserves),
    ...interestRateInfoMapping(config.rates),
    ...trackingInfoMapping(config.tracking),
    assetConfigs: _ => getAssetConfigs(config.assets, contracts),
    rewardTokenAddress: _ => (config.rewardToken || config.rewardTokenAddress) ?
      getContractAddress(config.rewardToken, contracts, config.rewardTokenAddress) :
      undefined,
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

export async function getConfigurationStruct(
  deploymentManager: DeploymentManager,
  configOverrides: ProtocolConfiguration = {},
): Promise<ConfigurationStruct> {
  const contracts = await deploymentManager.contracts();
  const configuration = (await getConfiguration(deploymentManager, configOverrides)) as ConfigurationStruct;
  const extensionDelegate = configOverrides.extensionDelegate ?? getContractAddress('comet:implementation:implementation', contracts);
  return { ...configuration, extensionDelegate };
}
