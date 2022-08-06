import { ContractMap } from '../../plugins/deployment_manager/ContractMap';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  Comet,
  CometExt,
  CometFactory,
  CometProxyAdmin,
  TransparentUpgradeableProxy,
  ConfiguratorProxy,
  Configurator,
  CometRewards,
} from '../../build/types';
import { ConfigurationStruct } from '../../build/types/Comet';
import { ExtConfigurationStruct } from '../../build/types/CometExt';

import { ContractsToDeploy, ProtocolConfiguration, debug, wait } from './index';
import { getConfiguration } from './NetworkConfiguration';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

export function sameAddress(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

export async function deployNetworkComet(
  deploymentManager: DeploymentManager,
  deploySpec: ContractsToDeploy = { all: true },
  configurationOverrides: ProtocolConfiguration = {},
  adminSigner?: SignerWithAddress,
) {
  function maybeForce(alias: string): boolean {
    return deploySpec.all || deploySpec[alias];
  }

  const admin = adminSigner ?? await deploymentManager.getSigner();
  const ethers = deploymentManager.hre.ethers;

  const {
    symbol,
    governor, // NB: generally 'timelock' alias, not 'governor'
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
  } = await getConfiguration(deploymentManager, configurationOverrides);

  const cometAdmin = await deploymentManager.deploy(
    'cometAdmin',
    'CometProxyAdmin.sol',
    [],
    maybeForce('cometAdmin')
  );

  const extConfiguration = { symbol32: ethers.utils.formatBytes32String(symbol) };
  const cometExt = await deploymentManager.deploy(
    'comet:implementation:implementation',
    'CometExt.sol',
    [extConfiguration],
    maybeForce('comet')
  );

  const cometFactory = await deploymentManager.deploy(
    'cometFactory',
    'CometFactory.sol',
    [],
    maybeForce('comet')
  );

  const cometProxy = await deploymentManager.deploy(
    'comet',
    'vendor/proxy/transparent/TransparentUpgradeableProxy.sol',
    [cometFactory.address, cometAdmin.address, []], // NB: temporary implementation contract
    maybeForce('comet'),
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

  const configuratorImpl = await deploymentManager.deploy(
    'configurator:implementation',
    'Configurator.sol',
    [],
    maybeForce('configurator')
  );

  // If we deploy a new proxy, we initialize it to the current/new impl
  // If its an existing proxy, the impl we got for the alias must already be current
  // In other words, we shan't have deployed an impl in the last step unless there was no proxy too
  const configuratorProxy = await deploymentManager.deploy(
    'configurator',
    'ConfiguratorProxy.sol',
    [configuratorImpl.address, cometAdmin.address, (await configuratorImpl.populateTransaction.initialize(admin.address)).data],
    maybeForce('configurator')
  );

  // Now configure the configurator and actually deploy comet
  // TODO: the success of these calls are also going to be dependent on who the admin is and if/when its been transferred
  const configurator = (configuratorImpl as Configurator).attach(configuratorProxy.address);

  await deploymentManager.idempotent(
    async () => !sameAddress(await configurator.factory(cometProxy.address), cometFactory.address),
    async () => {
      debug(`Setting factory in Configurator to ${cometFactory.address}`);
      await wait(configurator.connect(admin).setFactory(cometProxy.address, cometFactory.address));
    }
  );

  await deploymentManager.idempotent(
    async () => sameAddress((await configurator.getConfiguration(cometProxy.address)).baseToken, ethers.constants.AddressZero),
    async () => {
      debug(`Setting configuration in Configurator`);
      await wait(configurator.connect(admin).setConfiguration(cometProxy.address, configuration));
    }
  );

  await deploymentManager.idempotent(
    async () => !sameAddress(await configurator.governor(), governor),
    async () => {
      debug(`Transferring governor of Configurator to ${governor}`);
      await wait(configurator.connect(admin).transferGovernor(governor));
    }
  );

  await deploymentManager.idempotent(
    async () => sameAddress(await cometAdmin.getProxyImplementation(cometProxy.address), cometFactory.address),
    async () => {
      debug(`Deploying implementation of Comet`);
      await wait(cometAdmin.connect(admin).deployAndUpgradeTo(configurator.address, cometProxy.address));
    }
  );

  // XXX better to check owner is admin? what if its some previous governor?
  //  anyway if we never transfer ownership
  // await deploymentManager.idempotent(
  //   async () => !sameAddress(await cometAdmin.owner(), governor),
  //   async () => {
  //     debug(`Transferring ownership of CometProxyAdmin to ${governor}`);
  //     await wait(cometAdmin.connect(admin).transferOwnership(governor));
  //   }
  // );

  const rewards = await deploymentManager.deploy(
    'rewards',
    'CometRewards.sol',
    [governor],
    maybeForce('rewards')
  );
}
