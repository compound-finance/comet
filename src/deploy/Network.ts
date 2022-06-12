import { ContractMap } from '../../plugins/deployment_manager/ContractMap';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  Comet__factory,
  Comet,
  CometExt__factory,
  CometExt,
  CometFactory__factory,
  CometFactory,
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
  ProxyAdmin,
} from '../../build/types';
import { ConfigurationStruct } from '../../build/types/Comet';
import { ExtConfigurationStruct } from '../../build/types/CometExt';

import { DeployedContracts, DeployProxyOption, ProtocolConfiguration } from './index';
import { getConfiguration } from './NetworkConfiguration';

export async function deployNetworkComet(
  deploymentManager: DeploymentManager,
  deployProxy: DeployProxyOption = { deployCometProxy: true, deployConfiguratorProxy: true },
  configurationOverrides: ProtocolConfiguration = {},
  contractMapOverride?: ContractMap,
): Promise<DeployedContracts> {
  const admin = await deploymentManager.getSigner();

  const governorSimple = await deploymentManager.deploy<GovernorSimple, GovernorSimple__factory, []>(
    'test/GovernorSimple.sol',
    []
  );

  let timelock = await deploymentManager.deploy<SimpleTimelock, SimpleTimelock__factory, [string]>(
    'test/SimpleTimelock.sol',
    [governorSimple.address]
  );

  // Initialize the storage of GovernorSimple
  await governorSimple.initialize(timelock.address, [admin.address]);

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
    pauseGuardian: timelock.address,
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

  const cometFactory = await deploymentManager.deploy<CometFactory, CometFactory__factory, []>(
    'CometFactory.sol',
    []
  );

  const configurator = await deploymentManager.deploy<Configurator, Configurator__factory, []>(
    'Configurator.sol',
    []
  );

  /* === Proxies === */

  let updatedRoots = await deploymentManager.getRoots();
  let cometProxy = null;
  let configuratorProxy = null;
  let proxyAdmin = null;

  // If we are deploying new proxies for both Comet and Configurator, we will also deploy a new ProxyAdmin
  // because this is most likely going to be a completely fresh deployment.
  // Note: If this assumption is incorrect, we should probably add a third option in `DeployProxyOption` to
  //       specify if a new CometProxyAdmin should be deployed.
  if (deployProxy.deployCometProxy && deployProxy.deployConfiguratorProxy) {
    let proxyAdminArgs: [] = [];
    proxyAdmin = await deploymentManager.deploy<CometProxyAdmin, CometProxyAdmin__factory, []>(
      'CometProxyAdmin.sol',
      proxyAdminArgs
    );
    await proxyAdmin.transferOwnership(timelock.address);
  } else {
    // We don't want to be using a new ProxyAdmin/Timelock if we are not deploying both proxies
    proxyAdmin = await deploymentManager.contract('cometAdmin') as ProxyAdmin;
    timelock = await deploymentManager.contract('timelock') as SimpleTimelock;
  }

  if (deployProxy.deployConfiguratorProxy) {
    // Configuration proxy
    configuratorProxy = await deploymentManager.deploy<
      TransparentUpgradeableConfiguratorProxy,
      TransparentUpgradeableConfiguratorProxy__factory,
      [string, string, string]
    >('TransparentUpgradeableConfiguratorProxy.sol', [
      configurator.address,
      proxyAdmin.address,
      (await configurator.populateTransaction.initialize(timelock.address, cometFactory.address, configuration)).data, // new time lock is set, which we don't want
    ]);

    updatedRoots.set('configurator', configuratorProxy.address);
  }

  if (deployProxy.deployCometProxy) {
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

    updatedRoots.set('comet', cometProxy.address);
  }

  await deploymentManager.putRoots(updatedRoots);
  await deploymentManager.spider();

  return {
    comet,
    cometProxy,
    configuratorProxy,
    timelock,
    governor: governorSimple
  };
}
