import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { BigNumberish } from 'ethers';

import { ContractMap } from '../../plugins/deployment_manager/ContractMap';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  Comet__factory,
  Comet,
  CometExt__factory,
  CometExt,
  CometInterface,
  FaucetToken__factory,
  FaucetToken,
  ProxyAdmin,
  ProxyAdmin__factory,
  ERC20,
  TransparentUpgradeableProxy__factory,
  TransparentUpgradeableProxy,
} from '../../build/types';
import { ConfigurationStruct } from '../../build/types/Comet';
import { ExtConfigurationStruct } from '../../build/types/CometExt';

import { DeployedContracts, ProtocolConfiguration } from './index';
import { getConfiguration } from './NetworkConfiguration';

export async function deployNetworkComet(
  deploymentManager: DeploymentManager,
  deployProxy: boolean = true,
  configurationOverrides: ProtocolConfiguration = {},
  contractMapOverride?: ContractMap,
): Promise<DeployedContracts> {
  const {
    symbol,
    governor,
    pauseGuardian,
    baseToken,
    baseTokenPriceFeed,
    kink,
    perYearInterestRateSlopeLow,
    perYearInterestRateSlopeHigh,
    perYearInterestRateBase,
    reserveRate,
    trackingIndexScale,
    baseTrackingSupplySpeed,
    baseTrackingBorrowSpeed,
    baseMinForRewards,
    baseBorrowMin,
    targetReserves,
    assetConfigs,
  } = {
    ...await getConfiguration(deploymentManager.deployment, deploymentManager.hre, contractMapOverride),
    ...configurationOverrides
  };

  const extConfiguration = {
    symbol32: deploymentManager.hre.ethers.utils.formatBytes32String(symbol),
  };
  const cometExt = await deploymentManager.deploy<CometExt, CometExt__factory, [ExtConfigurationStruct]>(
    'CometExt.sol',
    [extConfiguration]
  );

  const configuration = {
    governor,
    pauseGuardian,
    baseToken,
    baseTokenPriceFeed,
    extensionDelegate: cometExt.address,
    kink,
    perYearInterestRateSlopeLow,
    perYearInterestRateSlopeHigh,
    perYearInterestRateBase,
    reserveRate,
    trackingIndexScale,
    baseTrackingSupplySpeed,
    baseTrackingBorrowSpeed,
    baseMinForRewards,
    baseBorrowMin,
    targetReserves,
    assetConfigs,
  };
  const comet = await deploymentManager.deploy<Comet, Comet__factory, [ConfigurationStruct]>(
    'Comet.sol',
    [configuration]
  );

  let proxy = null;
  if (deployProxy) {
    let proxyAdminArgs: [] = [];
    let proxyAdmin = await deploymentManager.deploy<ProxyAdmin, ProxyAdmin__factory, []>(
      'vendor/proxy/ProxyAdmin.sol',
      proxyAdminArgs
    );

    proxy = await deploymentManager.deploy<
      TransparentUpgradeableProxy,
      TransparentUpgradeableProxy__factory,
      [string, string, string]
    >('vendor/proxy/TransparentUpgradeableProxy.sol', [
      comet.address,
      proxyAdmin.address,
      (await comet.populateTransaction.initializeStorage()).data,
    ]);
  }

  return {
    comet: await deploymentManager.hre.ethers.getContractAt('CometInterface', comet.address) as CometInterface,
    proxy,
  };
}
