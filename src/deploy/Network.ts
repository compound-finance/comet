import { ContractMap } from '../../plugins/deployment_manager/ContractMap';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  CometInterface,
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
  function maybeForce(alias?: string): boolean {
    return deploySpec.all || (alias && deploySpec[alias]);
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

  console.log('xxxx', cometAdmin.address)
  // XXX most generally we would want to set the admin to admin
  //  then change admin to cometAdmin if not already, using passed in admin
  //   that way if cometAdmin is deployed we get the new one
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
  // Note: the success of these calls is dependent on who the admin is and if/when its been transferred
  //  scenarios can pass in an impersonated signer, but real deploys may require proposals for some states
  const configurator = (configuratorImpl as Configurator).attach(configuratorProxy.address);

  // Also get a handle for Comet, although it may not *actually* support the interface yet
  const comet = await deploymentManager.cast(cometProxy.address, 'contracts/CometInterface.sol:CometInterface');

  await deploymentManager.idempotent(
    async () => !sameAddress(await configurator.factory(comet.address), cometFactory.address),
    async () => {
      debug(`Setting factory in Configurator to ${cometFactory.address}`);
      await wait(configurator.connect(admin).setFactory(comet.address, cometFactory.address));
    }
  );

  await deploymentManager.idempotent(
    async () => sameAddress((await configurator.getConfiguration(comet.address)).baseToken, ethers.constants.AddressZero),
    async () => {
      debug(`Setting configuration in Configurator for ${comet.address}`);
      await wait(configurator.connect(admin).setConfiguration(comet.address, configuration));
    }
  );

  await deploymentManager.idempotent(
    async () => !sameAddress(await configurator.governor(), governor),
    async () => {
      debug(`Transferring governor of Configurator to ${governor}`);
      await wait(configurator.connect(admin).transferGovernor(governor));
    }
  );

  console.log('xxxx', await cometAdmin.owner(), admin.address, governor)
  await deploymentManager.idempotent(
    async () => sameAddress(await cometAdmin.getProxyImplementation(comet.address), cometFactory.address),
    async () => {
      debug(`Deploying first implementation of Comet and initializing...`);
      // XXX ok this works for changing factory -> first impl and initializing
      //  but what if we just want to do a change of impl? i.e. there's a new factory but not first
      // XXX do we have a way of *just* calling? unnecessary re-upgrade?
      const data = (await comet.populateTransaction.initializeStorage()).data;
      await wait(cometAdmin.connect(admin).deployUpgradeToAndCall(configurator.address, comet.address, data));
      debug(`Factory deployed implementation at ${await cometAdmin.getProxyImplementation(comet.address)}`);
    }
  );
  console.log('xxxx', await cometAdmin.owner(), admin.address, governor, (await deploymentManager.getSigner()).address)

  // XXX move? if we do this earlier, we might not be owner first time we deploy,
  // if not at all, no timelock contract, if now, not for upgrade
  await deploymentManager.idempotent(
    async () => !sameAddress(await cometAdmin.owner(), governor),
    async () => {
      debug(`Transferring ownership of CometProxyAdmin to ${governor}`);
      await wait(cometAdmin.connect(admin).transferOwnership(governor));
    }
  );

  const rewards = await deploymentManager.deploy(
    'rewards',
    'CometRewards.sol',
    [governor],
    maybeForce('rewards')
  );

  // XXX when to put roots?
  //  we are using deployment manager but not writing roots back?
  //   but wrapper is also calling put roots...?
  deploymentManager.putRoots(new Map([
    ['comet', comet.address],
    ['configurator', configurator.address],
    ['rewards', rewards.address],
  ])); // XXX
}
