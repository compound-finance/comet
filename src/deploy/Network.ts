import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { BigNumberish, utils } from 'ethers';

import { ContractMap } from '../../plugins/deployment_manager/ContractMap';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  Comet__factory,
  Comet,
  CometExt__factory,
  CometExt,
  CometInterface,
  CometFactory__factory,
  CometFactory,
  FaucetToken__factory,
  FaucetToken,
  GovernorSimple,
  GovernorSimple__factory,
  CometProxyAdmin,
  CometProxyAdmin__factory,
  TransparentUpgradeableProxy,
  TransparentUpgradeableProxy__factory,
  TransparentUpgradeableConfiguratorProxy,
  TransparentUpgradeableConfiguratorProxy__factory,
  Configurator,
  Configurator__factory,
  SimpleTimelock,
  SimpleTimelock__factory,
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
  const signers = await deploymentManager.hre.ethers.getSigners();
  const admin = await signers[0].getAddress();

  const governorSimple = await deploymentManager.deploy<GovernorSimple, GovernorSimple__factory, []>(
    'test/GovernorSimple.sol',
    []
  );

  const timelock = await deploymentManager.deploy<SimpleTimelock, SimpleTimelock__factory, [string]>(
    'test/SimpleTimelock.sol',
    [governorSimple.address]
  );

  // Initialize the storage of GovernorSimple
  await governorSimple.initialize(timelock.address, [admin])

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
    storeFrontPriceFactor,
    trackingIndexScale,
    baseTrackingSupplySpeed,
    baseTrackingBorrowSpeed,
    baseMinForRewards,
    baseBorrowMin,
    targetReserves,
    assetConfigs,
  } = {
    governor: timelock.address,
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
    storeFrontPriceFactor,
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

  let cometProxy = null;
  let configuratorProxy = null;
  if (deployProxy) {
    const cometFactory = await deploymentManager.deploy<CometFactory, CometFactory__factory, []>(
      'CometFactory.sol',
      []
    );

    const configurator = await deploymentManager.deploy<Configurator, Configurator__factory, []>(
      'Configurator.sol',
      []
    );

    let proxyAdminArgs: [] = [];
    let proxyAdmin = await deploymentManager.deploy<CometProxyAdmin, CometProxyAdmin__factory, []>(
      'CometProxyAdmin.sol',
      proxyAdminArgs
    );
    await proxyAdmin.transferOwnership(timelock.address);
    
    // Configuration proxy
    configuratorProxy = await deploymentManager.deploy<
      TransparentUpgradeableConfiguratorProxy,
      TransparentUpgradeableConfiguratorProxy__factory,
      [string, string, string]
    >('TransparentUpgradeableConfiguratorProxy.sol', [
      configurator.address,
      proxyAdmin.address,
      (await configurator.populateTransaction.initialize(timelock.address, cometFactory.address, configuration)).data,
    ]);
    
    // Comet proxy
    cometProxy = await deploymentManager.deploy<
      TransparentUpgradeableProxy,
      TransparentUpgradeableProxy__factory,
      [string, string, string]
    >('vendor/proxy/transparent/TransparentUpgradeableProxy.sol', [
      comet.address,
      proxyAdmin.address,
      (await comet.populateTransaction.initializeStorage()).data,
    ]);
  }

  return {
    comet,
    cometProxy,
    configuratorProxy,
    timelock,
    governor: governorSimple
  };
}
