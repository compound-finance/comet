import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { Configurator } from './../../../../build/types';
import { expect } from 'chai';
import { proposal } from '../../../../src/deploy';
import { utils, constants } from 'ethers';

const destinationChainSelector = '6916147374840168594';

const gauntletMultiSigAddress = '0xA34d0A0812AD443494A83c424fE25810d00cbdeC';

const localTimelockAddress = '0xBbb0Ebd903fafbb8fFF58B922fD0CD85E251ac2c';

const marketUpdateTimelockAddress = '0x7b525C648Eb683E660aAe3974E361B44a3Bf5E6d';
const marketUpdateProposerAddress = '0x33aD97b5BFbAd948467aBa0AEfDe09f189f60Cd4';
const newConfiguratorImplementationAddress = '0x25a5F30C875bfe203044ae4Cac2be8E137C50b37';
const newCometProxyAdminAddress = '0x3Da3A88c419c4d2805101423907aE801a4B19866';
const marketAdminPermissionCheckerAddress = '0x1Fdc7e3a707E2CcB96d44de077Dc21A36a2A2c80';

const pauseGuardianAddress = '0x69daaf2Fb26Cb138D33466808dE917d571151a68';

const cometProxyAdminOldAddress = '0xfa64A82a3d13D4c05d5133E53b2EbB8A0FA9c3F6';
const configuratorProxyAddress = '0x966c72F456FC248D458784EF3E0b6d042be115F2';
const cometProxyWethAddress = '0x4006eD4097Ee51c09A04c3B0951D28CCf19e6DFE';
const cometProxyWronAddress = '0xc0Afdbd1cEB621Ef576BA969ce9D4ceF78Dbc0c0';

export default migration('1753100132_gov_marketupdates', {
  prepare: async () => {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
  ) => {
    const trace = deploymentManager.tracer();

    const { bridgeReceiver } = await deploymentManager.getContracts();

    const {
      l1CCIPRouter,
      governor,
    } = await govDeploymentManager.getContracts();


    const changeProxyAdminForCometProxyWethCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyWethAddress, newCometProxyAdminAddress]
    );

    const changeProxyAdminForCometProxyWronCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyWronAddress, newCometProxyAdminAddress]
    );

    const changeProxyAdminForConfiguratorProxyCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configuratorProxyAddress, newCometProxyAdminAddress]
    );

    const upgradeConfiguratorProxyCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configuratorProxyAddress, newConfiguratorImplementationAddress]
    );

    const setMarketAdminPermissionCheckerForConfiguratorProxyCalldata = utils.defaultAbiCoder.encode(
      ['address'],
      [marketAdminPermissionCheckerAddress]
    );

    const setMarketAdminCalldata = utils.defaultAbiCoder.encode(
      ['address'],
      [gauntletMultiSigAddress]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          marketUpdateProposerAddress,
          cometProxyAdminOldAddress,
          cometProxyAdminOldAddress,
          cometProxyAdminOldAddress,
          newCometProxyAdminAddress,
          configuratorProxyAddress,
        ],
        [0, 0, 0, 0, 0, 0],
        [
          'setMarketAdmin(address)',
          'changeProxyAdmin(address,address)',
          'changeProxyAdmin(address,address)',
          'changeProxyAdmin(address,address)',
          'upgrade(address,address)',
          'setMarketAdminPermissionChecker(address)',
        ],
        [
          setMarketAdminCalldata,
          changeProxyAdminForCometProxyWronCalldata,
          changeProxyAdminForCometProxyWethCalldata,
          changeProxyAdminForConfiguratorProxyCalldata,
          upgradeConfiguratorProxyCalldata,
          setMarketAdminPermissionCheckerForConfiguratorProxyCalldata,
        ],
      ]
    );

    const fee = await l1CCIPRouter.getFee(destinationChainSelector, [
      utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
      l2ProposalData,
      [],
      constants.AddressZero,
      '0x'
    ]);

    const actions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet and set reward config on Arbitrum.
      {
        contract: l1CCIPRouter,
        signature: 'ccipSend(uint64,(bytes,bytes,(address,uint256)[],address,bytes))',
        args:
          [
            destinationChainSelector,
            [
              utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
              l2ProposalData,
              [],
              constants.AddressZero,
              '0x'
            ]
          ],
        value: fee
      },
    ];

    const description = `#Alternate Governance track for Market Updates - Ronin\n\n##Proposal summary\n
WOOF! proposes an alternate governance track for market updates on the Compound III markets on Ronin, following the successful deployment by DoDAO on the Optimism network. This proposal aims to streamline market parameter updates by introducing a parallel governance process, reducing friction, and enabling faster updates while maintaining community oversight.

Currently, 70-90% of proposals focus on market parameter updates, which require specialized validation and consume significant community resources (estimated at $300,000 annually). This process diverts attention from critical proposals like new partnerships or asset additions. By granting a market admin role to a Safe address (managed by Gauntlet or community members) and routing updates through a Timelock, the community can review or block changes while speeding up the process.

This proposal was discussed in detail here - https://www.comp.xyz/t/market-updates-alternate-governance-track/5379. OpenZeppelin provided feedback, recommending the Configurator update as the optimal solution. Simulations have confirmed the market’s readiness using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).


##Proposal Actions

This proposal executes a single cross-chain action via Chainlink's CCIP 'ccipSend', which forwards encoded instructions to the 'bridgeReceiver' on Ronin. The payload contains multiple actions that are executed on L2:

1. Setting new proposal guardian on the 'MarketUpdateProposer' contract.
2. Updating the proxy admin for the WRON and WETH Comet markets to a new 'CometProxyAdmin' contract.
3. Updating the proxy admin for the Configurator proxy to the new 'CometProxyAdmin'.
4. Upgrading the Configurator proxy to a new implementation.
5. Setting the 'MarketAdminPermissionChecker' on the Configurator, enabling an alternate governance track for faster market updates routed through a Timelock for community oversight.

All these actions can be executed on Ronin after this relay message is processed.
`;

    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(actions, description))))
    );

    const event = txn.events.find((event) => event.event === 'ProposalCreated');

    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const ethers = deploymentManager.hre.ethers;

    await deploymentManager.spider();
    const tracer = deploymentManager.tracer();

    const { configurator } = await deploymentManager.getContracts();

    const marketAdminPermissionChecker = await ethers.getContractAt(
      'MarketAdminPermissionChecker',
      marketAdminPermissionCheckerAddress
    );

    const marketUpdateTimelock = await ethers.getContractAt(
      'MarketUpdateTimelock',
      marketUpdateTimelockAddress
    );

    const marketUpdateProposer = await ethers.getContractAt(
      'MarketUpdateProposer',
      marketUpdateProposerAddress
    );

    const cometProxyAdminNew = await ethers.getContractAt(
      'CometProxyAdmin',
      newCometProxyAdminAddress
    );

    expect(configurator.address).to.be.equal(configuratorProxyAddress);
    expect(await (configurator as Configurator).governor()).to.be.equal(localTimelockAddress);
    expect(await (configurator as Configurator).marketAdminPermissionChecker()).to.be.equal(marketAdminPermissionCheckerAddress);

    expect(await cometProxyAdminNew.marketAdminPermissionChecker()).to.be.equal(marketAdminPermissionChecker.address);
    expect(await cometProxyAdminNew.owner()).to.be.equal(localTimelockAddress);

    expect(await marketAdminPermissionChecker.marketAdmin()).to.be.equal(marketUpdateTimelockAddress);
    expect(await marketAdminPermissionChecker.owner()).to.be.equal(localTimelockAddress);
    expect(await marketAdminPermissionChecker.marketAdminPauseGuardian()).to.be.equal(pauseGuardianAddress);

    expect(await marketUpdateTimelock.marketUpdateProposer()).to.be.equal(marketUpdateProposer.address);
    expect(await marketUpdateTimelock.governor()).to.be.equal(localTimelockAddress);
    expect(await marketUpdateTimelock.delay()).to.be.equal(2 * 24 * 60 * 60);

    expect(await marketUpdateProposer.governor()).to.be.equal(localTimelockAddress);
    expect(await marketUpdateProposer.marketAdmin()).to.be.equal(gauntletMultiSigAddress);

    expect(await marketUpdateProposer.timelock()).to.be.equal(marketUpdateTimelock.address);
    expect(await marketUpdateProposer.proposalGuardian()).to.be.equal(pauseGuardianAddress);

    tracer('All checks passed.');
  },
});
