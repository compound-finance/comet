import { Deployed, DeploymentManager } from '../../plugins/deployment_manager';
import { DeploySpec, ProtocolConfiguration, wait, COMP_WHALES } from './index';
import { getConfiguration } from './NetworkConfiguration';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

export function sameAddress(a: string, b: string) {
  return BigInt(a) === BigInt(b);
}

// XXX make sure we are deploying clone contracts from the cache
//  to preserve local development speed and without network
export async function cloneGov(
  deploymentManager: DeploymentManager,
  voterAddress = COMP_WHALES.testnet[0],
  adminSigner?: SignerWithAddress
): Promise<Deployed> {
  const trace = deploymentManager.tracer();
  const admin = adminSigner ?? await deploymentManager.getSigner();
  const clone = {
    comp: '0xc00e94cb662c3520282e6f5717214004a7f26888',
    governorBravoImpl: '0xef3b6e9e13706a8f01fe98fdcf66335dc5cfdeed',
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
    async () => (await COMP.balanceOf(admin.address)).gte((await COMP.totalSupply()).div(3)),
    async () => {
      trace(`Sending 1/4 of COMP to fauceteer, 1/4 to timelock`);
      const amount = (await COMP.balanceOf(admin.address)).div(4);
      trace(await wait(COMP.connect(admin).transfer(fauceteer.address, amount)));
      trace(await wait(COMP.connect(admin).transfer(timelock.address, amount)));
      trace(`COMP.balanceOf(${fauceteer.address}): ${await COMP.balanceOf(fauceteer.address)}`);
      trace(`COMP.balanceOf(${timelock.address}): ${await COMP.balanceOf(timelock.address)}`);
    }
  );

  await deploymentManager.idempotent(
    async () => (await COMP.getCurrentVotes(voterAddress)).eq(0),
    async () => {
      trace(`Delegating COMP votes to ${voterAddress}`);
      trace(await wait(COMP.connect(admin).delegate(voterAddress)));
      trace(`COMP.getCurrentVotes(${voterAddress}): ${await COMP.getCurrentVotes(voterAddress)}`);
    }
  );

  await deploymentManager.idempotent(
    async () => (await governor.proposalCount()).eq(0),
    async () => {
      trace(`Initiating Governor using patched Timelock`);
      trace(await wait(governor.connect(admin)._initiate(timelock.address)));
    }
  );

  await deploymentManager.idempotent(
    async () => !sameAddress(await timelock.admin(), governor.address),
    async () => {
      trace(`Transferring Governor of Timelock to ${governor.address}`);
      trace(await wait(timelock.connect(admin).setAdmin(governor.address)));
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

  const ethers = deploymentManager.hre.ethers;
  const trace = deploymentManager.tracer();
  const admin = adminSigner ?? await deploymentManager.getSigner();

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

  const tmpCometImpl = await deploymentManager.deploy(
    'comet:implementation',
    'Comet.sol',
    [configuration],
    maybeForce(),
  );
  const cometProxy = await deploymentManager.deploy(
    'comet',
    'vendor/proxy/transparent/TransparentUpgradeableProxy.sol',
    [tmpCometImpl.address, cometAdmin.address, []], // NB: temporary implementation contract
    maybeForce(),
  );

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

  // Call initializeStorage if storage not initialized
  // Note: we now rely on the fact that anyone may call, which helps separate the proposal
  await deploymentManager.idempotent(
    async () => (await comet.totalsBasic()).lastAccrualTime == 0,
    async () => {
      trace(`Initializing Comet at ${comet.address}`);
      trace(await wait(comet.connect(admin).initializeStorage()));
    }
  );

  // If we aren't admin, we'll need proposals to configure things
  const amAdmin = sameAddress(await cometAdmin.owner(), admin.address);

  // Get the current impl addresses for the proxies, and determine if we've configurated
  const $configuratorImpl = await cometAdmin.getProxyImplementation(configurator.address);
  const $cometImpl = await cometAdmin.getProxyImplementation(comet.address);
  const isTmpImpl = sameAddress($cometImpl, tmpCometImpl.address);

  // Note: these next setup steps may require a follow-up proposal to complete, if we cannot admin here
  await deploymentManager.idempotent(
    async () => amAdmin && !sameAddress($configuratorImpl, configuratorImpl.address),
    async () => {
      trace(`Setting Configurator implementation to ${configuratorImpl.address}`);
      trace(await wait(cometAdmin.connect(admin).upgrade(configurator.address, configuratorImpl.address)));
    }
  );

  await deploymentManager.idempotent(
    async () => amAdmin && !sameAddress(await configurator.factory(comet.address), cometFactory.address),
    async () => {
      trace(`Setting factory in Configurator to ${cometFactory.address}`);
      trace(await wait(configurator.connect(admin).setFactory(comet.address, cometFactory.address)));
    }
  );

  await deploymentManager.idempotent(
    async () => amAdmin && (isTmpImpl || deploySpec.all || deploySpec.cometMain || deploySpec.cometExt),
    async () => {
      trace(`Setting configuration in Configurator for ${comet.address} (${isTmpImpl})`);
      trace(await wait(configurator.connect(admin).setConfiguration(comet.address, configuration)));

      trace(`Upgrading implementation of Comet...`);
      trace(await wait(cometAdmin.connect(admin).deployAndUpgradeTo(configurator.address, comet.address)));

      trace(`New Comet implementation at ${await cometAdmin.getProxyImplementation(comet.address)}`);
    }
  );

  await deploymentManager.idempotent(
    async () => amAdmin && rewardTokenAddress !== undefined && !sameAddress((await rewards.rewardConfig(comet.address)).token, rewardTokenAddress),
    async () => {
      trace(`Setting reward token in CometRewards to ${rewardTokenAddress} for ${comet.address}`);
      trace(await wait(rewards.connect(admin).setRewardConfig(comet.address, rewardTokenAddress)));
    }
  );

  /* Transfer to Gov */

  await deploymentManager.idempotent(
    async () => !sameAddress(await configurator.governor(), governor),
    async () => {
      trace(`Transferring governor of Configurator to ${governor}`);
      trace(await wait(configurator.connect(admin).transferGovernor(governor)));
    }
  );

  await deploymentManager.idempotent(
    async () => !sameAddress(await cometAdmin.owner(), governor),
    async () => {
      trace(`Transferring ownership of CometProxyAdmin to ${governor}`);
      trace(await wait(cometAdmin.connect(admin).transferOwnership(governor)));
    }
  );

  await deploymentManager.idempotent(
    async () => !sameAddress(await rewards.governor(), governor),
    async () => {
      trace(`Transferring governor of CometRewards to ${governor}`);
      trace(await wait(rewards.connect(admin).transferGovernor(governor)));
    }
  );

  return { comet, configurator, rewards };
}
