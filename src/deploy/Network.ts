import { Deployed, DeploymentManager } from '../../plugins/deployment_manager';
import { DeploySpec, ProtocolConfiguration, debug, wait, COMP_WHALES } from './index';
import { getConfiguration } from './NetworkConfiguration';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

export function sameAddress(a: string, b: string) {
  return BigInt(a) === BigInt(b);
}

// XXX make sure we are deploying clone contracts from the cache
//  to preserve local development speed and without network
export async function cloneGov(
  deploymentManager: DeploymentManager,
  voterAddress = COMP_WHALES[0],
  adminSigner?: SignerWithAddress
): Promise<Deployed> {
  const admin = adminSigner ?? await deploymentManager.getSigner();
  const clone = {
    comp: '0xc00e94cb662c3520282e6f5717214004a7f26888',
    governorBravoImpl: '0x30065b703de5d473975a2db5bbb790a23fd6efbd',
    governorBravo: '0xc0da02939e1441f497fd74f78ce7decb17b66529',
  };

  const fauceteer = await deploymentManager.deploy('fauceteer', 'test/Fauceteer.sol', []);
  const timelock = await deploymentManager.deploy('timelock', 'test/SimpleTimelock.sol', [admin.address]);

  const COMP = await deploymentManager.clone('COMP', clone.comp, [admin.address]);

  const governorImpl = await deploymentManager.clone('governor:implementation', clone.governorBravoImpl, []);
  const governorProxy = await deploymentManager.clone('governor', clone.governorBravo, [
    timelock.address,
    COMP.address,
    admin.address,
    governorImpl.address,
    await governorImpl.MIN_VOTING_PERIOD(),
    await governorImpl.MIN_VOTING_DELAY(),
    await governorImpl.MIN_PROPOSAL_THRESHOLD(),
  ]);
  const governor = governorImpl.attach(governorProxy.address);

  await deploymentManager.idempotent(
    async () => (await COMP.balanceOf(admin.address)).eq(await COMP.totalSupply()),
    async () => {
      debug(`Sending 1/4 of all COMP to fauceteer, 1/4 to timelock`);
      const amount = (await COMP.totalSupply()).div(4);
      await wait(COMP.connect(admin).transfer(fauceteer.address, amount));
      await wait(COMP.connect(admin).transfer(timelock.address, amount));
      debug(`COMP.balanceOf(${fauceteer.address}): ${await COMP.balanceOf(fauceteer.address)}`);
      debug(`COMP.balanceOf(${timelock.address}): ${await COMP.balanceOf(timelock.address)}`);
    }
  );

  await deploymentManager.idempotent(
    async () => (await COMP.getCurrentVotes(voterAddress)).eq(0),
    async () => {
      debug(`Delegating COMP votes to ${voterAddress}`);
      await wait(COMP.connect(admin).delegate(voterAddress));
      debug(`COMP.getCurrentVotes(${voterAddress}): ${await COMP.getCurrentVotes(voterAddress)}`);
    }
  );

  await deploymentManager.idempotent(
    async () => (await governor.proposalCount()).eq(0),
    async () => {
      debug(`Initiating Governor using patched Timelock`);
      await wait(governor.connect(admin)._initiate(timelock.address));
    }
  );

  await deploymentManager.idempotent(
    async () => !sameAddress(await timelock.admin(), governor.address),
    async () => {
      debug(`Transferring Governor of Timelock to ${governor.address}`);
      await wait(timelock.connect(admin).setAdmin(governor.address));
    }
  );

  return { COMP, fauceteer, governor, timelock };
}

export async function deployNetworkComet(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec = { all: true },
  configOverrides: ProtocolConfiguration = {},
  adminSigner?: SignerWithAddress,
): Promise<Deployed> {
  function maybeForce(flag?: boolean): boolean {
    return deploySpec.all || flag;
  }

  const admin = adminSigner ?? await deploymentManager.getSigner();
  const ethers = deploymentManager.hre.ethers;

  const {
    name,
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
    rewardTokenAddress
  } = await getConfiguration(deploymentManager, configOverrides);

  /* Deploy contracts */

  const cometAdmin = await deploymentManager.deploy(
    'cometAdmin',
    'CometProxyAdmin.sol',
    [],
    maybeForce()
  );

  const extConfiguration = {
    name32: ethers.utils.formatBytes32String(name),
    symbol32: ethers.utils.formatBytes32String(symbol)
  };
  const cometExt = await deploymentManager.deploy(
    'comet:implementation:implementation',
    'CometExt.sol',
    [extConfiguration],
    maybeForce(deploySpec.cometExt)
  );

  const cometFactory = await deploymentManager.deploy(
    'cometFactory',
    'CometFactory.sol',
    [],
    maybeForce(deploySpec.cometMain)
  );

  const cometProxy = await deploymentManager.deploy(
    'comet',
    'vendor/proxy/transparent/TransparentUpgradeableProxy.sol',
    [cometFactory.address, cometAdmin.address, []], // NB: temporary implementation contract
    maybeForce(),
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
    maybeForce(deploySpec.cometMain)
  );

  // If we deploy a new proxy, we initialize it to the current/new impl
  // If its an existing proxy, the impl we got for the alias must already be current
  // In other words, we shan't have deployed an impl in the last step unless there was no proxy too
  const configuratorProxy = await deploymentManager.deploy(
    'configurator',
    'ConfiguratorProxy.sol',
    [configuratorImpl.address, cometAdmin.address, (await configuratorImpl.populateTransaction.initialize(admin.address)).data],
    maybeForce()
  );

  const rewards = await deploymentManager.deploy(
    'rewards',
    'CometRewards.sol',
    [admin.address],
    maybeForce(deploySpec.rewards)
  );

  /* Wire things up */

  // Now configure the configurator and actually deploy comet
  // Note: the success of these calls is dependent on who the admin is and if/when its been transferred
  //  scenarios can pass in an impersonated signer, but real deploys may require proposals for some states
  const configurator = configuratorImpl.attach(configuratorProxy.address);

  // Also get a handle for Comet, although it may not *actually* support the interface yet
  const comet = await deploymentManager.cast(cometProxy.address, 'contracts/CometInterface.sol:CometInterface');

  // Get the currently impl addresses for the proxies, and determine if this is the first deploy
  const $configuratorImpl = await cometAdmin.getProxyImplementation(configurator.address);
  const $cometImpl = await cometAdmin.getProxyImplementation(comet.address);
  const isFirstDeploy = sameAddress($cometImpl, cometFactory.address);

  await deploymentManager.idempotent(
    async () => !sameAddress($configuratorImpl, configuratorImpl.address),
    async () => {
      debug(`Setting Configurator implementation to ${configuratorImpl.address}`);
      await wait(cometAdmin.connect(admin).upgrade(configurator.address, configuratorImpl.address));
    }
  );

  await deploymentManager.idempotent(
    async () => !sameAddress(await configurator.factory(comet.address), cometFactory.address),
    async () => {
      debug(`Setting factory in Configurator to ${cometFactory.address}`);
      await wait(configurator.connect(admin).setFactory(comet.address, cometFactory.address));
    }
  );

  await deploymentManager.idempotent(
    async () => isFirstDeploy || deploySpec.all || deploySpec.cometMain || deploySpec.cometExt,
    async () => {
      debug(`Setting configuration in Configurator for ${comet.address}`);
      await wait(configurator.connect(admin).setConfiguration(comet.address, configuration));

      if (isFirstDeploy) {
        debug(`Deploying first implementation of Comet and initializing...`);
        const data = (await comet.populateTransaction.initializeStorage()).data;
        await wait(cometAdmin.connect(admin).deployUpgradeToAndCall(configurator.address, comet.address, data));
      } else {
        debug(`Upgrading implementation of Comet...`);
        await wait(cometAdmin.connect(admin).deployAndUpgradeTo(configurator.address, comet.address));
      }

      debug(`New Comet implementation at ${await cometAdmin.getProxyImplementation(comet.address)}`);
    }
  );

  await deploymentManager.idempotent(
    async () => !sameAddress((await rewards.rewardConfig(comet.address)).token, rewardTokenAddress),
    async () => {
      debug(`Setting reward token in CometRewards to ${rewardTokenAddress}`);
      await wait(rewards.connect(admin).setRewardConfig(comet.address, rewardTokenAddress));
    }
  );

  /* Transfer to Gov */

  await deploymentManager.idempotent(
    async () => !sameAddress(await configurator.governor(), governor),
    async () => {
      debug(`Transferring governor of Configurator to ${governor}`);
      await wait(configurator.connect(admin).transferGovernor(governor));
    }
  );

  await deploymentManager.idempotent(
    async () => !sameAddress(await cometAdmin.owner(), governor),
    async () => {
      debug(`Transferring ownership of CometProxyAdmin to ${governor}`);
      await wait(cometAdmin.connect(admin).transferOwnership(governor));
    }
  );

  await deploymentManager.idempotent(
    async () => !sameAddress(await rewards.governor(), governor),
    async () => {
      debug(`Transferring governor of CometRewards to ${governor}`);
      await wait(rewards.connect(admin).transferGovernor(governor));
    }
  );

  return { comet, configurator, rewards };
}
