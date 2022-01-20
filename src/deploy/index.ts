import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { hasNetworkConfiguration } from './NetworkConfiguration';
import { DeploymentManager, Roots } from '../../plugins/deployment_manager/DeploymentManager';
import {
  Comet__factory,
  Comet,
  FaucetToken__factory,
  FaucetToken,
  ProxyAdmin,
  ProxyAdmin__factory,
  ERC20,
  TransparentUpgradeableProxy__factory,
  TransparentUpgradeableProxy,
} from '../../build/types';
import { AssetInfoStruct, ConfigurationStruct } from '../../build/types/Comet';
import { BigNumberish } from 'ethers';
export { Comet } from '../../build/types';
import { deployNetworkComet } from './Network';
import { deployDevelopmentComet } from './Development';

export interface CometConfigurationOverrides {
  governor?: string;
  pauseGuardian?: string;
  priceOracle?: string;
  baseToken?: string;
  trackingIndexScale?: string;
  baseMinForRewards?: BigNumberish;
  baseTrackingSupplySpeed?: BigNumberish;
  baseTrackingBorrowSpeed?: BigNumberish;
  assetInfo?: AssetInfoStruct[];
  kink?: BigNumberish;
  perYearInterestRateBase?: BigNumberish;
  perYearInterestRateSlopeLow?: BigNumberish;
  perYearInterestRateSlopeHigh?: BigNumberish;
  reserveRate?: BigNumberish;
}

export interface DeployedContracts {
  comet: Comet;
  proxy: TransparentUpgradeableProxy | null;
  tokens?: ERC20[];
}

export async function deployComet(
  deploymentManager: DeploymentManager,
  deployProxy: boolean = true,
  configurationOverrides: CometConfigurationOverrides = {}
): Promise<DeployedContracts> {
  // If we have a `configuration.json` for the network, use it.
  // Otherwise, we do a "development"-style deploy, which deploys fake tokens, etc, and generally
  // provides less value than a full-fledged test-net or mainnet fork.
  if (await hasNetworkConfiguration(deploymentManager.deployment)) {
    return await deployNetworkComet(deploymentManager, deployProxy, configurationOverrides);
  } else {
    return await deployDevelopmentComet(deploymentManager, deployProxy, configurationOverrides);
  }
}
