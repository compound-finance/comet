import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import {Comet, FaucetToken, SimplePriceFeed, MarketUpdateProposer, CometProxyAdmin, SimpleTimelock, CometProxyAdminOld, MarketUpdateTimelock, CometFactory, ConfiguratorProxy, Configurator__factory} from '../../../build/types';
import {
  DeploySpec,
  exp,
  wait,
  getConfiguration,
  sameAddress,
  getConfigurationStruct
} from '../../../src/deploy';
import '@nomiclabs/hardhat-ethers';
import { ethers } from 'hardhat';

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

async function advanceTimeAndMineBlock(delay: number) {
  await ethers.provider.send('evm_increaseTime', [delay + 10]);
  await ethers.provider.send('evm_mine', []); // Mine a new block to apply the time increase
}

// TODO: Support configurable assets as well?
export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer();
  const signer = await deploymentManager.getSigner();
  const ethers = deploymentManager.hre.ethers;
  const admin = signer;

  // Deploy governance contracts
  const clone = {
    comp: '0xc00e94cb662c3520282e6f5717214004a7f26888',
    governorBravoImpl: '0xef3b6e9e13706a8f01fe98fdcf66335dc5cfdeed',
    governorBravo: '0xc0da02939e1441f497fd74f78ce7decb17b66529',
  };

  const fauceteer = await deploymentManager.deploy('fauceteer', 'test/Fauceteer.sol', []);
  const timelock = await deploymentManager.deploy('timelock', 'test/SimpleTimelock.sol', [admin.address]) as SimpleTimelock;
  const COMP = await deploymentManager.clone('COMP', clone.comp, [admin.address]);
  
  const governorImpl = await deploymentManager.clone(
    'governor:implementation',
    clone.governorBravoImpl,
    []
  );
  const governorProxy = await deploymentManager.clone(
    'governor',
    clone.governorBravo,
    [
      timelock.address,
      COMP.address,
      admin.address,
      governorImpl.address,
      await governorImpl.MIN_VOTING_PERIOD(),
      await governorImpl.MIN_VOTING_DELAY(),
      await governorImpl.MIN_PROPOSAL_THRESHOLD(),
    ]
  );
  const governorBravo = governorImpl.attach(governorProxy.address);
  await deploymentManager.idempotent(
    async () => (await governorBravo.proposalCount()).eq(0),
    async () => {
      trace(`Initiating Governor using patched Timelock`);
      trace(await wait(governorBravo.connect(admin)._initiate(timelock.address)));
    }
  );
  await timelock.connect(admin).setAdmin(governorBravo.address);

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
    async () => (await COMP.getCurrentVotes(admin.address)).eq(0),
    async () => {
      trace(`Delegating COMP votes to ${admin.address}`);
      trace(await wait(COMP.connect(admin).delegate(admin.address)));
      trace(`COMP.getCurrentVotes(${admin.address}): ${await COMP.getCurrentVotes(admin.address)}`);
    }
  );

  const DAI = await makeToken(deploymentManager, 10000000, 'DAI', 18, 'DAI');
  const GOLD = await makeToken(deploymentManager, 20000000, 'GOLD', 8, 'GOLD');
  const SILVER = await makeToken(deploymentManager, 30000000, 'SILVER', 10, 'SILVER');

  const daiPriceFeed = await makePriceFeed(deploymentManager, 'DAI:priceFeed', 1, 8);
  const goldPriceFeed = await makePriceFeed(deploymentManager, 'GOLD:priceFeed', 0.5, 8);
  const silverPriceFeed = await makePriceFeed(deploymentManager, 'SILVER:priceFeed', 0.05, 8);

  const assetConfig0 = {
    asset: GOLD.address,
    priceFeed: goldPriceFeed.address,
    decimals: (8).toString(),
    borrowCollateralFactor: (0.9e18).toString(),
    liquidateCollateralFactor: (0.91e18).toString(),
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

  const configOverrides = {
    baseTokenPriceFeed: daiPriceFeed.address,
    assetConfigs: [assetConfig0, assetConfig1],
  };

  const rewards = await deploymentManager.deploy(
    'rewards',
    'CometRewards.sol',
    [admin.address],
    maybeForce(deploySpec.rewards)
  );

  await deploymentManager.idempotent(
    async () => (await GOLD.balanceOf(rewards.address)).eq(0),
    async () => {
      trace(`Sending some GOLD to CometRewards`);
      const amount = exp(2_000_000, 8);
      trace(await wait(GOLD.connect(signer).transfer(rewards.address, amount)));
      trace(`GOLD.balanceOf(${rewards.address}): ${await GOLD.balanceOf(rewards.address)}`);
    }
  );

  function maybeForce(flag?: boolean): boolean {
    return deploySpec.all || flag;
  }


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
  } = await getConfiguration(deploymentManager, configOverrides);

  /* Deploy contracts */

  const cometProxyAdminOld = await deploymentManager.deploy(
    'cometAdminOld',
    'marketupdates/CometProxyAdminOld.sol',
    [],
    maybeForce()
  ) as CometProxyAdminOld;



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
  ) as CometFactory;

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
  trace('Timelock address:', timelock.address);
  trace('Governor address:', governor);

  const tmpCometImpl = await deploymentManager.deploy(
    'comet:implementation',
    'Comet.sol',
    [configuration],
    maybeForce(),
  ) as Comet;

  trace('Checking tmpCometImpl:supplyKink');
  console.log('tmpCometImpl:supplyKink', await tmpCometImpl.supplyKink());
  const cometProxyContract = await deploymentManager.deploy(
    'comet',
    'vendor/proxy/transparent/TransparentUpgradeableProxy.sol',
    [tmpCometImpl.address, cometProxyAdminOld.address, []], // NB: temporary implementation contract
    maybeForce()
  );
  const factory= await ethers.getContractFactory('Comet');
  const cometProxy= factory.attach(cometProxyContract.address) as Comet;

  trace('tmpCometImpl', tmpCometImpl.address);

  trace('Checking CometProxy:supplyKink');
  console.log('CometProxy:supplyKink', await cometProxy.supplyKink());


  const configuratorImpl = await deploymentManager.deploy(
    'configurator-old:implementation',
    'marketupdates/ConfiguratorOld.sol',
    [],
    maybeForce(deploySpec.cometMain)
  );

  // If we deploy a new proxy, we initialize it to the current/new impl
  // If its an existing proxy, the impl we got for the alias must already be current
  // In other words, we shan't have deployed an impl in the last step unless there was no proxy too
  const configuratorProxyContract = await deploymentManager.deploy(
    'configurator',
    'ConfiguratorProxy.sol',
    [configuratorImpl.address, signer.address, (await configuratorImpl.populateTransaction.initialize(admin.address)).data],
    maybeForce()
  ) as ConfiguratorProxy;

  const configuratorFactory = await ethers.getContractFactory('Configurator') as Configurator__factory;
  const configuratorProxy =  configuratorFactory.attach(configuratorProxyContract.address);
  trace(`Setting factory in Configurator to ${cometFactory.address}`);
  await configuratorProxy.connect(admin).setFactory(cometProxy.address, cometFactory.address);


  const configurationStr = await getConfigurationStruct(deploymentManager);
  trace(`Setting configuration in Configurator for ${cometProxy.address}`);
  await configuratorProxy.connect(admin).setConfiguration(cometProxy.address, configurationStr);
  // await txSetConfiguration.wait();


  trace(`Upgrading implementation of Comet...`);

  await configuratorProxyContract.changeAdmin(cometProxyAdminOld.address);

  await cometProxyAdminOld.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address);

  await cometProxyAdminOld.transferOwnership(timelock.address);

  /* Wire things up */

  // Now configure the configurator and actually deploy comet
  // Note: the success of these calls is dependent on who the admin is and if/when its been transferred
  //  scenarios can pass in an impersonated signer, but real deploys may require proposals for some states
  const configurator = configuratorImpl.attach(configuratorProxyContract.address);

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
  const amAdmin = sameAddress(await cometProxyAdminOld.owner(), admin.address);
  trace(`Am I admin? ${amAdmin}`);

  // Get the current impl addresses for the proxies, and determine if we've configurated
  const $cometImpl = await cometProxyAdminOld.getProxyImplementation(comet.address);
  const isTmpImpl = sameAddress($cometImpl, tmpCometImpl.address);
  trace(`isTmpImpl ${isTmpImpl} deploySpec.all ${deploySpec.all} deploySpec.cometMain  ${deploySpec.cometMain} deploySpec.cometExt ${deploySpec.cometExt}`);


  /* Transfer to Gov */

  await deploymentManager.idempotent(
    async () => !sameAddress(await configurator.governor(), governor),
    async () => {
      trace(`Transferring governor of Configurator to ${governor}`);
      trace(await wait(configurator.connect(admin).transferGovernor(governor)));
    }
  );

  await deploymentManager.idempotent(
    async () => !sameAddress(await cometProxyAdminOld.owner(), governor),
    async () => {
      trace(`Transferring ownership of CometProxyAdmin to ${governor}`);
      trace(await wait(cometProxyAdminOld.connect(admin).transferOwnership(governor)));
    }
  );

  await deploymentManager.idempotent(
    async () => !sameAddress(await rewards.governor(), governor),
    async () => {
      trace(`Transferring governor of CometRewards to ${governor}`);
      trace(await wait(rewards.connect(admin).transferGovernor(governor)));
    }
  );


  // Mint some tokens
  trace(`Attempting to mint as ${signer.address}...`);

  await Promise.all(
    [[DAI, 1e8], [GOLD, 2e6], [SILVER, 1e7]].map(([faucetToken, unitOfToken]) => {
      const asset = faucetToken as FaucetToken;
      const units = unitOfToken as number;

      return deploymentManager.idempotent(
        async () => (await asset.balanceOf(fauceteer.address)).eq(0),
        async () => {
          trace(`Minting ${units} ${await asset.symbol()} to fauceteer`);
          const amount = exp(units, await asset.decimals());
          trace(await wait(asset.connect(signer).allocateTo(fauceteer.address, amount)));
          trace(`asset.balanceOf(${signer.address}): ${await asset.balanceOf(signer.address)}`);
        }
      );
    })
  );

  const supplyKinkOld = await comet.supplyKink();
  trace(`supplyKink:`, supplyKinkOld);

  const signers = await ethers.getSigners();

  const marketUpdateTimelock = (await deploymentManager.deploy(
    'marketUpdateTimelock',
    'marketupdates/MarketUpdateTimelock.sol',
    [governor, 2 * 24 * 60 * 60],
    maybeForce()
  )) as MarketUpdateTimelock;

  // 1) Deploy the address of MarketAdminMultiSig
  const marketUpdateMultiSig = signers[3];
  const proposalGuardian = signers[11];

  const marketUpdateProposer = await deploymentManager.deploy(
    'marketUpdateProposer',
    'marketupdates/MarketUpdateProposer.sol',
    [governor, marketUpdateMultiSig.address, proposalGuardian.address, marketUpdateTimelock.address],
    maybeForce()
  ) as MarketUpdateProposer;

  const cometProxyAdminNew = await deploymentManager.deploy(
    'cometProxyAdminNew',
    'CometProxyAdmin.sol',
    [],
    maybeForce()
  ) as CometProxyAdmin;

  await cometProxyAdminNew.transferOwnership(governor);

  const configuratorNew = await deploymentManager.deploy(
    'configuratorNew',
    'Configurator.sol',
    [],
    maybeForce()
  );

  const marketAdminPermissionChecker = await deploymentManager.deploy(
    'marketAdminPermissionChecker',
    'marketupdates/MarketAdminPermissionChecker.sol',
    [ethers.constants.AddressZero, ethers.constants.AddressZero],
    maybeForce()
  );

  await marketAdminPermissionChecker.transferOwnership(
    governor
  );

  const newSupplyKinkByGovernorTimelock = 300n;

  trace('Trigger updates to enable market admin');
  const firstProposalTxn = await governorBravo
    .connect(admin)
    .propose(
      [
        cometProxyAdminOld.address,
        cometProxyAdminOld.address,
        cometProxyAdminNew.address,
        marketAdminPermissionChecker.address,
        configuratorProxyContract.address,
        cometProxyAdminNew.address,
        marketUpdateTimelock.address,
      ],
      [0, 0, 0, 0, 0, 0, 0],
      [
        'changeProxyAdmin(address,address)',
        'changeProxyAdmin(address,address)',
        'upgrade(address,address)',
        'setMarketAdmin(address)',
        'setMarketAdminPermissionChecker(address)',
        'setMarketAdminPermissionChecker(address)',
        'setMarketUpdateProposer(address)',
      ],
      [
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'address'],
          [configuratorProxyContract.address, cometProxyAdminNew.address]
        ),
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'address'],
          [cometProxy.address, cometProxyAdminNew.address]
        ),
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'address'],
          [configuratorProxyContract.address, configuratorNew.address]
        ),
        ethers.utils.defaultAbiCoder.encode(
          ['address'],
          [marketUpdateTimelock.address]
        ),
        ethers.utils.defaultAbiCoder.encode(
          ['address'],
          [marketAdminPermissionChecker.address]
        ),
        ethers.utils.defaultAbiCoder.encode(
          ['address'],
          [marketAdminPermissionChecker.address]
        ),
        ethers.utils.defaultAbiCoder.encode(
          ['address'],
          [marketUpdateProposer.address]
        ),
      ],
      'Proposal to trigger updates for market admin'
    );
  const firstProposalReceipt = await firstProposalTxn.wait();

  const firstProposalID = firstProposalReceipt.events.find( 
    (event) => event.event === 'ProposalCreated'
  ).args.id;
  console.log('first proposal id: ', firstProposalID);
  
  const stateBeforeStart = await governorBravo.state(firstProposalID);
  console.log('Proposal State before start block forwarding:', stateBeforeStart);
  
  const votingDelay = await governorBravo.votingDelay();
  // Fast-forward by votingDelay blocks to reach the start of the voting period
  for (let i = 0; i < votingDelay.toNumber(); i++) {
    await ethers.provider.send('evm_mine', []);
  }
  const stateAfterStart = await governorBravo.state(firstProposalID);
  console.log('Proposal State after start block forwarding:', stateAfterStart);
  
  await governorBravo.connect(admin).castVote(firstProposalID, 1);
  
  const votingPeriod = await governorBravo.votingPeriod(); 
  // Fast-forward to the end of the voting period
  for (let i = 0; i <= votingPeriod.toNumber(); i++) {
    await ethers.provider.send('evm_mine', []); // fast-forward remaining blocks
  }
  
  const stateAfter = await governorBravo.state(firstProposalID);
  console.log('Proposal State after fast-forward:', stateAfter);
  
  trace('Queue from Governor Bravo');
  await governorBravo.connect(admin).queue(firstProposalID);
  trace('Execute from Governor Bravo');
  await governorBravo.connect(admin).execute(firstProposalID);
  
  trace('Update supply kink through GovernorBravo');
  const secondProposalTxn = await governorBravo.connect(admin).propose(
    [
      configuratorProxyContract.address,
      cometProxyAdminNew.address
    ],
    [0,0],
    [
      'setSupplyKink(address,uint64)',
      'deployAndUpgradeTo(address,address)'
    ],
    [
      ethers.utils.defaultAbiCoder.encode(['address', 'uint64'], [cometProxy.address, newSupplyKinkByGovernorTimelock]),
      ethers.utils.defaultAbiCoder.encode(['address', 'address'], [configuratorProxyContract.address, cometProxy.address])
    ],
    'Proposal to update supply kink'
  );
  const secondProposalReceipt = await secondProposalTxn.wait();

  const secondProposalID = secondProposalReceipt.events.find( 
    (event) => event.event === 'ProposalCreated'
  ).args.id;
  console.log('second proposal id: ', secondProposalID);
  
  const stateBeforeStart2 = await governorBravo.state(secondProposalID);
  console.log('Proposal State before start block forwarding #2:', stateBeforeStart2);
  
  const votingDelay2 = await governorBravo.votingDelay();
  // Fast-forward by votingDelay blocks to reach the start of the voting period
  for (let i = 0; i < votingDelay2.toNumber(); i++) {
    await ethers.provider.send('evm_mine', []);
  }
  const stateAfterStart2 = await governorBravo.state(secondProposalID);
  console.log('Proposal State after start block forwarding #2:', stateAfterStart2);
  
  await governorBravo.connect(admin).castVote(secondProposalID, 1);
  
  const votingPeriod2 = await governorBravo.votingPeriod(); 
  // Fast-forward to the end of the voting period
  for (let i = 0; i <= votingPeriod2.toNumber(); i++) {
    await ethers.provider.send('evm_mine', []); // fast-forward remaining blocks
  }
  
  const stateAfter2 = await governorBravo.state(secondProposalID);
  console.log('Proposal State after fast-forward #2:', stateAfter2);
  
  trace('Queue from Governor Bravo #2');
  await governorBravo.connect(admin).queue(secondProposalID);
  trace('Execute from Governor Bravo #2');
  await governorBravo.connect(admin).execute(secondProposalID);
  
  const supplyKinkByGovernorTimelock = await (<Comet>comet).supplyKink();
  trace(`supplyKinkByGovernorTimelock:`, supplyKinkByGovernorTimelock);
  
  trace('MarketAdmin: Setting new supplyKink in Configurator and deploying Comet');
  const newSupplyKinkByMarketAdmin = 100n;
  await marketUpdateProposer.connect(marketUpdateMultiSig).propose(
    [
      configuratorProxyContract.address,
      cometProxyAdminNew.address
    ],
    [0, 0],
    [
      'setSupplyKink(address,uint64)',
      'deployAndUpgradeTo(address,address)'
    ],
    [
      ethers.utils.defaultAbiCoder.encode(['address', 'uint64'], [cometProxy.address, newSupplyKinkByMarketAdmin]),
      ethers.utils.defaultAbiCoder.encode(['address', 'address'], [configuratorProxyContract.address, cometProxy.address])
    ],
    'Test market update'
  );

  await advanceTimeAndMineBlock(2 * 24 * 60 * 60 + 10); // Fast forwarding by 2 days and a few seconds

  trace('Executing market update proposal');

  await marketUpdateProposer.connect(marketUpdateMultiSig).execute(1);

  trace('checking supplyKink after market update');
  const supplyKinkByMarketAdmin = await (<Comet>cometProxy).supplyKink();
  trace(`supplyKinkByMarketAdmin:`, supplyKinkByMarketAdmin);

  return {  comet, configurator, rewards, fauceteer };
}
