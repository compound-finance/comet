import { hasNetworkConfiguration } from './NetworkConfiguration';
import { ContractMap } from '../../plugins/deployment_manager/ContractMap';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  Comet,
  ERC20,
  TransparentUpgradeableProxy,
} from '../../build/types';
import { AssetConfigStruct } from '../../build/types/Comet';
import { BigNumberish } from 'ethers';
import { deployNetworkComet } from './Network';
import { deployDevelopmentComet } from './Development';

let priceFeeds = {
  kovan: {
    comp: '0xECF93D14d25E02bA2C13698eeDca9aA98348EFb6',
    wbtc: '0x6135b13325bfC4B00278B4abC5e20bbce2D6580e',
    weth: '0x9326BFA02ADD2366b30bacB125260Af641031331',
    uni: '0xDA5904BdBfB4EF12a3955aEcA103F51dc87c7C39',
    link: '0x396c5E36DD0a0F5a5D33dae44368D4193f69a1F0',
  },
};

export interface ProtocolConfiguration {
  symbol?: string;
  governor?: string;
  pauseGuardian?: string;
  baseToken?: string;
  baseTokenPriceFeed?: string;
  kink?: BigNumberish;
  perYearInterestRateBase?: BigNumberish;
  perYearInterestRateSlopeLow?: BigNumberish;
  perYearInterestRateSlopeHigh?: BigNumberish;
  reserveRate?: BigNumberish;
  trackingIndexScale?: BigNumberish;
  baseTrackingSupplySpeed?: BigNumberish;
  baseTrackingBorrowSpeed?: BigNumberish;
  baseMinForRewards?: BigNumberish;
  baseBorrowMin?: BigNumberish;
  targetReserves?: BigNumberish;
  assetConfigs?: AssetConfigStruct[];
}

export interface DeployedContracts {
  comet: Comet;
  proxy: TransparentUpgradeableProxy | null;
  tokens?: ERC20[];
}

export async function deployComet(
  deploymentManager: DeploymentManager,
  deployProxy: boolean = true,
  configurationOverrides: ProtocolConfiguration = {},
  contractMapOverride?: ContractMap,
): Promise<DeployedContracts> {
  // If we have a `configuration.json` for the network, use it.
  // Otherwise, we do a "development"-style deploy, which deploys fake tokens, etc, and generally
  // provides less value than a full-fledged test-net or mainnet fork.
  if (await hasNetworkConfiguration(deploymentManager.deployment)) {
    return await deployNetworkComet(deploymentManager, deployProxy, configurationOverrides, contractMapOverride);
  } else {
    return await deployDevelopmentComet(deploymentManager, deployProxy, configurationOverrides);
  }
}

export function getPriceFeed(name: string, network: string): string {
  let networkFeeds = priceFeeds[network];
  if (!networkFeeds) {
    throw new Error(`No known price feeds for network ${network}`);
  }
  let priceFeed = networkFeeds[name.toLowerCase()];
  if (!priceFeed) {
    throw new Error(`No known price feeds for ${name} on network ${network}`);
  }
  return priceFeed;
}
