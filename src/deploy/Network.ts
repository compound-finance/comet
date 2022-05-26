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

function sleepAndLog(ms: number) {
  return new Promise((resolve) => {
    console.log(`sleeping for ${ms}ms`);
    setTimeout(resolve, ms);
  });
}

export async function deployNetworkComet(
  deploymentManager: DeploymentManager,
  deployProxy: DeployProxyOption = { deployCometProxy: true, deployConfiguratorProxy: true },
  configurationOverrides: ProtocolConfiguration = {},
  contractMapOverride?: ContractMap,
): Promise<DeployedContracts> {
  const signers = await deploymentManager.hre.ethers.getSigners();
  const admin = await signers[0].getAddress();

  const governorSimple = await deploymentManager.cached<GovernorSimple, GovernorSimple__factory, []>(
    'test/GovernorSimple.sol',
    []
  );

  await sleepAndLog(1000);

  let timelock = await deploymentManager.cached<SimpleTimelock, SimpleTimelock__factory, [string]>(
    'test/SimpleTimelock.sol',
    [governorSimple.address]
  );

  await sleepAndLog(1000);

  // Initialize the storage of GovernorSimple
  // await governorSimple.initialize(timelock.address, [admin]);

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

  await sleepAndLog(1000);

  const cometExt = await deploymentManager.cached<CometExt, CometExt__factory, [ExtConfigurationStruct]>(
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

  await sleepAndLog(1000);

  const comet = await deploymentManager.cached<Comet, Comet__factory, [ConfigurationStruct]>(
    'Comet.sol',
    [configuration]
  );

  await sleepAndLog(1000);

  const cometFactory = await deploymentManager.cached<CometFactory, CometFactory__factory, []>(
    'CometFactory.sol',
    []
  );

  await sleepAndLog(1000);

  const configurator = await deploymentManager.cached<Configurator, Configurator__factory, []>(
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
