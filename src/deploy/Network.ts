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
  ConfiguratorProxy,
  ConfiguratorProxy__factory,
  Configurator,
  Configurator__factory,
  SimpleTimelock,
  SimpleTimelock__factory,
  ProxyAdmin,
  CometInterface,
} from '../../build/types';
import { ConfigurationStruct } from '../../build/types/Comet';
import { ExtConfigurationStruct } from '../../build/types/CometExt';

import { DeployedContracts, DeployProxyOption, ProtocolConfiguration } from './index';
import { getConfiguration } from './NetworkConfiguration';
import { extractCalldata, fastGovernanceExecute } from '../utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

export async function deployNetworkComet(
  deploymentManager: DeploymentManager,
  deployProxy: DeployProxyOption = { deployCometProxy: true, deployConfiguratorProxy: true },
  configurationOverrides: ProtocolConfiguration = {},
  contractMapOverride?: ContractMap,
  adminSigner?: SignerWithAddress,
): Promise<DeployedContracts> {
  if (adminSigner == null) {
    adminSigner = await deploymentManager.getSigner();
  }

  let governorSimple = await deploymentManager.deploy<GovernorSimple, GovernorSimple__factory, []>(
    'test/GovernorSimple.sol',
    []
  );

  let timelock = await deploymentManager.deploy<SimpleTimelock, SimpleTimelock__factory, [string]>(
    'test/SimpleTimelock.sol',
    [governorSimple.address]
  );

  // Initialize the storage of GovernorSimple
  await governorSimple.initialize(timelock.address, [adminSigner.address]);

  const {
    symbol,
    governor,
    pauseGuardian,
    baseToken,
    baseTokenPriceFeed,
    supplyKink,
    supplyPerYearInterestRateSlopeLow,
    supplyPerYearInterestRateSlopeHigh,
    supplyPerYearInterestRateBase,
    borrowKink,
    borrowPerYearInterestRateSlopeLow,
    borrowPerYearInterestRateSlopeHigh,
    borrowPerYearInterestRateBase,
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
    supplyKink,
    supplyPerYearInterestRateSlopeLow,
    supplyPerYearInterestRateSlopeHigh,
    supplyPerYearInterestRateBase,
    borrowKink,
    borrowPerYearInterestRateSlopeLow,
    borrowPerYearInterestRateSlopeHigh,
    borrowPerYearInterestRateBase,
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
    // We don't want to be using a new ProxyAdmin/Timelock/Governor if we are not deploying both proxies
    proxyAdmin = await deploymentManager.contract('cometAdmin') as ProxyAdmin;
    timelock = await deploymentManager.contract('timelock') as SimpleTimelock;
    governorSimple = await deploymentManager.contract('governor') as GovernorSimple;
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
  } else {
    // Use the existing Comet proxy if a new one is not deployed
    // XXX This, along with Spider aliases, may need to be redesigned to support multiple Comet deployments
    cometProxy = await deploymentManager.contract('comet') as CometInterface;
  }

  if (deployProxy.deployConfiguratorProxy) {
    // Configuration proxy
    configuratorProxy = await deploymentManager.deploy<
      ConfiguratorProxy,
      ConfiguratorProxy__factory,
      [string, string, string]
    >('ConfiguratorProxy.sol', [
      configurator.address,
      proxyAdmin.address,
      (await configurator.populateTransaction.initialize(timelock.address)).data,
    ]);

    // Set the initial factory and configuration for Comet in Configurator
    const setFactoryCalldata = extractCalldata((await configurator.populateTransaction.setFactory(cometProxy.address, cometFactory.address)).data);
    const setConfigurationCalldata = extractCalldata((await configurator.populateTransaction.setConfiguration(cometProxy.address, configuration)).data);
    await fastGovernanceExecute(
      governorSimple.connect(adminSigner),
      [configuratorProxy.address, configuratorProxy.address],
      [0, 0],
      [
        'setFactory(address,address)',
        'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
      ],
      [setFactoryCalldata, setConfigurationCalldata]
    );

    updatedRoots.set('configurator', configuratorProxy.address);
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
