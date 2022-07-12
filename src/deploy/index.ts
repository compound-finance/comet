import { hasNetworkConfiguration } from './NetworkConfiguration';
import { ContractMap } from '../../plugins/deployment_manager/ContractMap';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  Comet,
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

export interface DeployProxyOption {
  deployCometProxy?: boolean;
  deployConfiguratorProxy?: boolean;
}

interface DeployCometOptionalParams {
  contractMapOverride?: ContractMap;
  adminSigner?: SignerWithAddress;
}

export interface DeployedContracts {
  comet: Comet;
  cometProxy: TransparentUpgradeableProxy | null;
  configuratorProxy: TransparentUpgradeableProxy | null;
  timelock: SimpleTimelock;
  governor: GovernorSimple;
  tokens?: ERC20[];
}

export async function deployComet(
  deploymentManager: DeploymentManager,
  deployProxy: DeployProxyOption = { deployCometProxy: true, deployConfiguratorProxy: true },
  configurationOverrides: ProtocolConfiguration = {},
  optionalParams: DeployCometOptionalParams = {},
): Promise<DeployedContracts> {
  // If we have a `configuration.json` for the network, use it.
  // Otherwise, we do a "development"-style deploy, which deploys fake tokens, etc, and generally
  // provides less value than a full-fledged test-net or mainnet fork.
  if (await hasNetworkConfiguration(deploymentManager.deployment)) {
    return await deployNetworkComet(deploymentManager, deployProxy, configurationOverrides, optionalParams.contractMapOverride, optionalParams.adminSigner);
  } else {
    return await deployDevelopmentComet(deploymentManager, deployProxy, configurationOverrides);
  }
}
