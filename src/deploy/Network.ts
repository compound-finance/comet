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
  CometRewards,
  CometRewards__factory,
} from '../../build/types';
import { ConfigurationStruct } from '../../build/types/Comet';
import { ExtConfigurationStruct } from '../../build/types/CometExt';

import { ContractsToDeploy, DeployedContracts, ProtocolConfiguration } from './index';
import { getConfiguration } from './NetworkConfiguration';
import { shouldDeploy } from '../utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { wait } from '../../test/helpers';
import { debug } from '../../plugins/deployment_manager/Utils';

export async function deployNetworkComet(
  deploymentManager: DeploymentManager,
  contractsToDeploy: ContractsToDeploy = { all: true },
  configurationOverrides: ProtocolConfiguration = {},
  contractMapOverride?: ContractMap,
  adminSigner_?: SignerWithAddress,
): Promise<DeployedContracts> {
  let adminSigner: SignerWithAddress = adminSigner_;
  if (adminSigner == null) {
    adminSigner = await deploymentManager.getSigner();
  }

  let ethers = deploymentManager.hre.ethers;
  let governorSimple, timelock, proxyAdmin, cometExt, cometProxy, configuratorProxy, comet, configurator, cometFactory, rewards: CometRewards;

  /* === Deploy Contracts === */

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.governor)) {
    governorSimple = await deploymentManager.deploy<GovernorSimple, GovernorSimple__factory, []>(
      'test/GovernorSimple.sol',
      []
    );
  } else {
    governorSimple = await deploymentManager.contract('governor') as GovernorSimple;
  }

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.timelock)) {
    timelock = await deploymentManager.deploy<SimpleTimelock, SimpleTimelock__factory, [string]>(
      'test/SimpleTimelock.sol',
      [governorSimple.address]
    );
  } else {
    timelock = await deploymentManager.contract('timelock') as SimpleTimelock;
  }

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.governor)) {
    // Initialize the storage of GovernorSimple
    debug(`Initializing GovSimple`);
    await deploymentManager.asyncCallWithRetry(
      (signer_) => wait(governorSimple.connect(signer_).initialize(timelock.address, [adminSigner.address]))
    );
  }

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
    rewardTokenAddress
  } = {
    governor: timelock ? timelock.address : ethers.constants.AddressZero,
    pauseGuardian: timelock ? timelock.address : ethers.constants.AddressZero,
    ...await getConfiguration(deploymentManager, contractMapOverride, configurationOverrides),
  };

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.cometExt)) {
    const extConfiguration = {
      symbol32: ethers.utils.formatBytes32String(symbol),
    };
    cometExt = await deploymentManager.deploy<CometExt, CometExt__factory, [ExtConfigurationStruct]>(
      'CometExt.sol',
      [extConfiguration]
    );
  } else {
    cometExt = await deploymentManager.contract('comet:implementation:implementation') as CometExt;
  }

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

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.comet)) {
    comet = await deploymentManager.deploy<Comet, Comet__factory, [ConfigurationStruct]>(
      'Comet.sol',
      [configuration]
    );
  } else {
    comet = await deploymentManager.contract('comet:implementation') as CometInterface;
  }

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.cometFactory)) {
    cometFactory = await deploymentManager.deploy<CometFactory, CometFactory__factory, []>(
      'CometFactory.sol',
      []
    );
  } else {
    // XXX need to handle the fact that there can be multiple Comet factories
  }

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.configurator)) {
    configurator = await deploymentManager.deploy<Configurator, Configurator__factory, []>(
      'Configurator.sol',
      []
    );
  } else {
    configurator = await deploymentManager.contract('configurator:implementation') as Configurator;
  }

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.cometProxyAdmin)) {
    let proxyAdminArgs: [] = [];
    proxyAdmin = await deploymentManager.deploy<CometProxyAdmin, CometProxyAdmin__factory, []>(
      'CometProxyAdmin.sol',
      proxyAdminArgs
    );
    debug(`Transferring ownership of ProxyAdmin to ${governor}`);
    await deploymentManager.asyncCallWithRetry(
      (signer_) => wait(proxyAdmin.connect(signer_).transferOwnership(governor))
    );
  } else {
    proxyAdmin = await deploymentManager.contract('cometAdmin') as ProxyAdmin;
  }

  let updatedRoots = await deploymentManager.getRoots();
  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.cometProxy)) {
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

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.configuratorProxy)) {
    // Configuration proxy
    configuratorProxy = await deploymentManager.deploy<
      ConfiguratorProxy,
      ConfiguratorProxy__factory,
      [string, string, string]
    >('ConfiguratorProxy.sol', [
      configurator.address,
      proxyAdmin.address,
      (await configurator.populateTransaction.initialize(adminSigner.address)).data,
    ]);

    // Set the initial factory and configuration for Comet in Configurator
    const configuratorAsProxy = (configurator as Configurator).attach(configuratorProxy.address);
    debug(`Setting factory in Configurator`);
    await deploymentManager.asyncCallWithRetry(
      (signer_) => wait(configuratorAsProxy.connect(adminSigner_ ?? signer_).setFactory(cometProxy.address, cometFactory.address))
    );
    debug(`Setting configuration in Configurator`);
    await deploymentManager.asyncCallWithRetry(
      (signer_) => wait(configuratorAsProxy.connect(adminSigner_ ?? signer_).setConfiguration(cometProxy.address, configuration))
    );

    // Transfer ownership of Configurator
    debug(`Transferring ownership of Configurator`);
    await deploymentManager.asyncCallWithRetry(
      (signer_) => wait(configuratorAsProxy.connect(adminSigner_ ?? signer_).transferGovernor(governor))
    );

    updatedRoots.set('configurator', configuratorProxy.address);
  } else {
    configuratorProxy = await deploymentManager.contract('configurator') as Configurator;
  }


  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.rewards)) {
    rewards = await deploymentManager.deploy<CometRewards, CometRewards__factory, [string]>(
      'CometRewards.sol',
      [adminSigner.address]
    );

    // Set the rewards config for Comet in CometRewards
    // XXX we should validate rewardTokenAddress is set earlier
    debug(`Setting RewardConfig in CometRewards`);
    await deploymentManager.asyncCallWithRetry(
      (signer_) => wait(rewards.connect(adminSigner_ ?? signer_).setRewardConfig(cometProxy.address, rewardTokenAddress))
    );

    // Transfer ownership of CometRewards
    debug(`Transferring ownership of CometRewards`);
    await deploymentManager.asyncCallWithRetry(
      (signer_) => wait(rewards.connect(adminSigner_ ?? signer_).transferGovernor(governor))
    );

    updatedRoots.set('rewards', rewards.address);
  } else {
    rewards = await deploymentManager.contract('rewards') as CometRewards;
  }

  await deploymentManager.putRoots(updatedRoots);

  return {
    comet,
    cometProxy,
    configuratorProxy,
    timelock,
    governor: governorSimple,
    rewards
  };
}
