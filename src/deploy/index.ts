import { hasNetworkConfiguration } from './NetworkConfiguration';
import { ContractMap } from '../../plugins/deployment_manager/ContractMap';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  Comet,
  CometRewards,
  ERC20,
  GovernorSimple,
  SimpleTimelock,
  TransparentUpgradeableProxy,
} from '../../build/types';
import { AssetConfigStruct } from '../../build/types/Comet';
import { BigNumberish } from 'ethers';
import { deployNetworkComet } from './Network';
import { deployDevelopmentComet } from './Development';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

export interface ProtocolConfiguration {
  symbol?: string;
  governor?: string;
  pauseGuardian?: string;
  baseToken?: string;
  baseTokenPriceFeed?: string;
  supplyKink?: BigNumberish;
  supplyPerYearInterestRateBase?: BigNumberish;
  supplyPerYearInterestRateSlopeLow?: BigNumberish;
  supplyPerYearInterestRateSlopeHigh?: BigNumberish;
  borrowKink?: BigNumberish;
  borrowPerYearInterestRateBase?: BigNumberish;
  borrowPerYearInterestRateSlopeLow?: BigNumberish;
  borrowPerYearInterestRateSlopeHigh?: BigNumberish;
  storeFrontPriceFactor?: BigNumberish;
  trackingIndexScale?: BigNumberish;
  baseTrackingSupplySpeed?: BigNumberish;
  baseTrackingBorrowSpeed?: BigNumberish;
  baseMinForRewards?: BigNumberish;
  baseBorrowMin?: BigNumberish;
  targetReserves?: BigNumberish;
  assetConfigs?: AssetConfigStruct[];
}

// Specific contracts take precedence over `all`, which allows for expressions
// such as:
// { all: true, timelock: false }
// which will deploy all contracts other than Timelock
export interface ContractsToDeploy {
  all?: boolean;
  cometProxy?: boolean;
  configuratorProxy?: boolean;
  cometProxyAdmin?: boolean;
  timelock?: boolean;
  governor?: boolean;
  cometExt?: boolean;
  comet?: boolean;
  configurator?: boolean;
  cometFactory?: boolean;
  rewards?: boolean;
}

interface DeployCometOptionalParams {
  contractsToDeploy?: ContractsToDeploy;
  configurationOverrides?: ProtocolConfiguration;
  contractMapOverride?: ContractMap;
  adminSigner?: SignerWithAddress;
}

export interface DeployedContracts {
  comet: Comet;
  cometProxy: TransparentUpgradeableProxy | null;
  configuratorProxy: TransparentUpgradeableProxy | null;
  timelock: SimpleTimelock;
  governor: GovernorSimple;
  rewards: CometRewards;
  tokens?: ERC20[];
}

export async function deployComet(
  deploymentManager: DeploymentManager,
  optionalParams: DeployCometOptionalParams = {},
): Promise<DeployedContracts> {
  // If we have a `configuration.json` for the network, use it.
  // Otherwise, we do a "development"-style deploy, which deploys fake tokens, etc, and generally
  // provides less value than a full-fledged test-net or mainnet fork.
  if (await hasNetworkConfiguration(deploymentManager.deployment)) {
    return await deployNetworkComet(deploymentManager, optionalParams.contractsToDeploy, optionalParams.configurationOverrides, optionalParams.contractMapOverride, optionalParams.adminSigner);
  } else {
    return await deployDevelopmentComet(deploymentManager, optionalParams.contractsToDeploy, optionalParams.configurationOverrides);
  }
}
