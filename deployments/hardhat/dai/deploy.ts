import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { FaucetToken, IGovernorBravo, SimplePriceFeed, TimelockInterface } from '../../../build/types';
import { DeploySpec, debug, deployComet, sameAddress, wait } from '../../../src/deploy';

const cloneNetwork = 'mainnet';

const GOVERNOR_ALPHA = '0xc0da01a04c3f3e0be433606045bb7017a7323e38'; // ??? correct Gov Alpha?
const GOVERNOR_BRAVO_DELEGATOR = '0xc0da02939e1441f497fd74f78ce7decb17b66529';
const GOVERNOR_BRAVO_DELEGATE = '0x30065b703de5d473975a2db5bbb790a23fd6efbd';
const TIMELOCK = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925';
const COMP_ADDRESS = '0xc00e94cb662c3520282e6f5717214004a7f26888';

async function makeToken(
  deploymentManager: DeploymentManager,
  amount: number,
  name: string,
  decimals: number,
  symbol: string
): Promise<FaucetToken> {
  const mint = (BigInt(amount) * 10n ** BigInt(decimals)).toString();
  return deploymentManager.deploy(symbol, 'test/FaucetToken.sol', [mint, name, decimals, symbol]);
}

async function makePriceFeed(
  deploymentManager: DeploymentManager,
  alias: string,
  initialPrice: number,
  decimals: number
): Promise<SimplePriceFeed> {
  return deploymentManager.deploy(alias, 'test/SimplePriceFeed.sol', [initialPrice * 1e8, decimals]);
}

type GovernanceContracts = {
  timelock: TimelockInterface;
  governor: IGovernorBravo;
}

async function cloneGovernance(dm: DeploymentManager, compAddress: string): Promise<GovernanceContracts> {
  const signer = await dm.getSigner();

  const day = 60 * 60 * 24;

  // clone the timelock
  const timelock = await dm.clone(
    "Timelock",
    TIMELOCK,
    [signer.address, 2 * day],
    cloneNetwork
  );

  // clone the Governor Alpha
  const governorAlpha = await dm.clone(
    "GovernorAlpha",
    GOVERNOR_ALPHA,
    [timelock.address, compAddress, signer.address], // timelock, comp, guardian
    cloneNetwork
  );

  // clone GovernorDelegate
  const governorDelegate = await dm.clone(
    "GovernorBravoDelegate",
    GOVERNOR_BRAVO_DELEGATE,
    [],
    cloneNetwork
  );

  // clone GovernorDelegator
  const governorDelegator = await dm.clone(
    "GovernorBravoDelegator",
    GOVERNOR_BRAVO_DELEGATOR,
    [
      timelock.address, // timelock
      compAddress, // comp
      signer.address, // admin
      governorDelegate.address, // implementation
      5760, // voting periond (set to min voting period0
      1, // voting delay (set to min voting delay)
      1000000000000000000000n // proposal threshold (set to min proposal threshold)
    ],
    cloneNetwork
  );
  const governor = governorDelegate.attach(governorDelegator.address);

  // XXX create a governor alpha proposal
  //     function propose(address[] memory targets, uint[] memory values, string[] memory signatures, bytes[] memory calldatas, string memory description) public returns (uint) {
  console.log(`governorAlpha.address: ${governorAlpha.address}`);
  console.log(`signer.address: ${signer.address}`);
  console.log(`await governorAlpha.proposalThreshold(): ${await governorAlpha.proposalThreshold()}`);

  await dm.hre.network.provider.send('evm_increaseTime', [3 * day]);
  await dm.hre.network.provider.send('evm_mine'); // ensure block is mined

  await governorAlpha.connect(signer).propose(
    [timelock.address], // targets
    [0], // values
    [""], // signatures,
    [],// calldata
    "test proposal description" // description
  );

  console.log("governorAlpha proposal done");

  const setPendingAdminCalldata = dm.hre.ethers.utils.defaultAbiCoder.encode(['address'], [governor.address]);

  const blockNumber = await dm.hre.ethers.provider.getBlockNumber();
  const blockTimestamp = (await dm.hre.ethers.provider.getBlock(blockNumber)).timestamp;
  const eta = blockTimestamp + (2 * day) + 100; // buffer

  await timelock.queueTransaction(
    timelock.address,
    0, // value
    'setPendingAdmin(address)',
    setPendingAdminCalldata,
    eta
  );

  // fast forward 3 days
  await dm.hre.network.provider.send('evm_increaseTime', [3 * day]);
  await dm.hre.network.provider.send('evm_mine'); // ensure block is mined

  await timelock.executeTransaction(
    timelock.address,
    0, // value
    'setPendingAdmin(address)',
    setPendingAdminCalldata,
    eta
  );

  await governor._initiate(governorAlpha.address);

  return {
    timelock,
    governor
  };
}

// TODO: Support configurable assets as well?
export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const ethers = deploymentManager.hre.ethers;
  const [admin, pauseGuardianSigner, minter] = await deploymentManager.getSigners();

  console.log(`admin.address: ${admin.address}`);

  // XXX will fail if gov already has a diff timelock, and technically should otherwise ensure admin
  //  but we are anyway replacing gov simple
  // await deploymentManager.idempotent(
  //   async () => !sameAddress(await governor.timelock(), timelock.address),
  //   async () => {
  //     debug(`Initializing GovSimple`);
  //     await wait(governor.connect(admin).initialize(timelock.address, [admin.address]));
  //   }
  // );

  const DAI = await makeToken(deploymentManager, 1000000, 'DAI', 18, 'DAI');
  const GOLD = await makeToken(deploymentManager, 2000000, 'GOLD', 8, 'GOLD');
  const SILVER = await makeToken(deploymentManager, 3000000, 'SILVER', 10, 'SILVER');
  const COMP = await deploymentManager.clone('COMP', COMP_ADDRESS, [minter.address], cloneNetwork);

  const daiPriceFeed = await makePriceFeed(deploymentManager, 'DAI:priceFeed', 1, 8);
  const goldPriceFeed = await makePriceFeed(deploymentManager, 'GOLD:priceFeed', 0.5, 8);
  const silverPriceFeed = await makePriceFeed(deploymentManager, 'SILVER:priceFeed', 0.05, 8);

  const assetConfig0 = {
    asset: GOLD.address,
    priceFeed: goldPriceFeed.address,
    decimals: (8).toString(),
    borrowCollateralFactor: (0.9e18).toString(),
    liquidateCollateralFactor: (1e18).toString(),
    liquidationFactor: (0.95e18).toString(),
    supplyCap: (1000000e8).toString(),
  };

  const assetConfig1 = {
    asset: SILVER.address,
    priceFeed: silverPriceFeed.address,
    decimals: (10).toString(),
    borrowCollateralFactor: (0.4e18).toString(),
    liquidateCollateralFactor: (0.5e18).toString(),
    liquidationFactor: (0.9e18).toString(),
    supplyCap: (500000e10).toString(),
  };
  // XXX add COMP asset config?

  // XXX idempotent?
  debug(`Sending half of all COMP to admin`);
  const amount = (await COMP.balanceOf(minter.address));
  await wait(COMP.connect(minter).transfer(admin.address, amount));
  debug(`COMP.balanceOf(${admin.address}): ${await COMP.balanceOf(admin.address)}`);

  const blockNumber = await deploymentManager.hre.ethers.provider.getBlockNumber();
  const blockTimestamp = (await deploymentManager.hre.ethers.provider.getBlock(blockNumber)).timestamp;
  await deploymentManager.hre.network.provider.send('evm_mine', [blockTimestamp + 100]); // ensure block is mined

  console.log(`await COMP.getPriorVotes(): ${await COMP.getPriorVotes(admin.address, blockNumber)}`);

  // XXX idempotent?
  const { timelock, governor } = await cloneGovernance(deploymentManager, COMP.address); // XXX SILVER as reward address?

  // Deploy all Comet-related contracts
  return deployComet(
    deploymentManager,
    deploySpec,
    {
      baseTokenPriceFeed: daiPriceFeed.address,
      assetConfigs: [assetConfig0, assetConfig1],
      governor: timelock.address, // XXX? timelock not governor?
      pauseGuardian: timelock.address
    }
  );
}
