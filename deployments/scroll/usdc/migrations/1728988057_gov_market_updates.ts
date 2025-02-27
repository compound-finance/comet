import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import {
  MarketAdminPermissionChecker,
  MarketUpdateProposer,
  MarketUpdateTimelock,
  CometProxyAdmin,
  Configurator,
} from './../../../../build/types';
import { expect } from 'chai';
import { exp, proposal } from '../../../../src/deploy';

interface Vars {}

const marketAdminAddress = '0x7e14050080306cd36b47DE61ce604b3a1EC70c4e';

const localTimelockAddress = '0xF6013e80E9e6AC211Cc031ad1CE98B3Aa20b73E4';

const marketUpdateTimelockAddress = '0x81Bc6016Fa365bfE929a51Eec9217B441B598eC6';
const marketUpdateProposerAddress = '0xB6Ef3AC71E9baCF1F4b9426C149d855Bfc4415F9';
const newConfiguratorImplementationAddress = '0x371DB45c7ee248dAFf4Dc1FFB67A20faa0ecFE02';
const newCometProxyAdminAddress = '0x24D86Da09C4Dd64e50dB7501b0f695d030f397aF';
const marketAdminPermissionCheckerAddress = '0x62DD0452411113404cf9a7fE88A5E6E86f9B71a6';

const communityMultiSigAddress = '0x0747a435b8a60070A7a111D015046d765098e4cc';

const cometProxyAdminOldAddress = '0x87A27b91f4130a25E9634d23A5B8E05e342bac50';
const configuratorProxyAddress = '0xECAB0bEEa3e5DEa0c35d3E69468EAC20098032D7';
const cometProxyAddress = '0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44';

export default migration('1728988057_gov_market_updates', {
  prepare: async () => {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
  ) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    const { bridgeReceiver } = await deploymentManager.getContracts();

    const { scrollMessenger, governor } =
      await govDeploymentManager.getContracts();


    const changeProxyAdminForCometProxyCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyAddress, newCometProxyAdminAddress]
    );

    const changeProxyAdminForConfiguratorProxyCalldata =
      utils.defaultAbiCoder.encode(
        ['address', 'address'],
        [configuratorProxyAddress, newCometProxyAdminAddress]
      );

    const upgradeConfiguratorProxyCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configuratorProxyAddress, newConfiguratorImplementationAddress]
    );

    const setMarketAdminPermissionCheckerForConfiguratorProxyCalldata =
      utils.defaultAbiCoder.encode(
        ['address'],
        [marketAdminPermissionCheckerAddress]
      );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          cometProxyAdminOldAddress,
          cometProxyAdminOldAddress,
          newCometProxyAdminAddress,
          configuratorProxyAddress,
        ],
        [0, 0, 0, 0],
        [
          'changeProxyAdmin(address,address)',
          'changeProxyAdmin(address,address)',
          'upgrade(address,address)',
          'setMarketAdminPermissionChecker(address)',
        ],
        [
          changeProxyAdminForCometProxyCalldata,
          changeProxyAdminForConfiguratorProxyCalldata,
          upgradeConfiguratorProxyCalldata,
          setMarketAdminPermissionCheckerForConfiguratorProxyCalldata,
        ],
      ]
    );

    const actions = [
      {
        contract: scrollMessenger,
        signature: 'sendMessage(address,uint256,bytes,uint256)',
        args: [bridgeReceiver.address, 0, l2ProposalData, 6_000_000],
        value: exp(0.1, 18),
      },
    ];

    const description =
      `DoDAO has been examining various areas where improvements can be made to governance in Compound through tooling or automation. A significant issue raised repeatedly by many members concerns the time and effort required to apply Market Updates.

Currently, approximately 70-90% of the proposals pertain solely to updating market parameters. Gauntlet uses analytics and algorithms to determine new parameters based on current market conditions. These proposals are highly specific and require unique skills for validation. So far, we have seen minimal participation from other community members or teams in validating these parameters.

Assuming the total cost of reviewing a proposal (including the effort of all delegates) is $2,000 per proposal, we are spending upwards of $300,000 per year on a process that currently acts more as a friction layer without much safeguard, as these market update proposals are rarely reviewed thoroughly.

This not only slows down the process but also diverts focus from reviewing essential proposals related to new partnerships, the addition of new chains, and the introduction of assets, etc.

We propose a parallel process specifically for market updates that can bypass the normal governance lifecycle. This would enable us, as a Compound community, to move faster and concentrate on the most critical decisions.

This proposal has already been discussed here - https://www.comp.xyz/t/market-updates-alternate-governance-track/5379 

The forum post includes two solutions, and OpenZeppelin has provided details and feedback on those solutions.

After discussing with OpenZeppelin, DoDAO and OZ together believe that given the amount of changes, updating the Configurator could be the best solution. OpenZeppelin mentioned a couple of important points in the forum post:

1. Grant the market admin role to an Safe address, which can be maintained by Gauntlet or other community members.
2. Market Updates to the Configurator will go through a timelock, providing sufficient time for the community to review or even block the market updates via this alternate route.
`;

    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(actions, description))))
    );

    const event = txn.events.find((event) => event.event === 'ProposalCreated');

    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    await deploymentManager.spider();
    const tracer = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const { configurator } = await deploymentManager.getContracts();

    const marketAdminPermissionChecker = (await ethers.getContractAt(
      'MarketAdminPermissionChecker',
      marketAdminPermissionCheckerAddress
    )) as MarketAdminPermissionChecker;

    const marketUpdateTimelock = (await ethers.getContractAt(
      'MarketUpdateTimelock',
      marketUpdateTimelockAddress
    )) as MarketUpdateTimelock;

    const marketUpdateProposer = (await ethers.getContractAt(
      'MarketUpdateProposer',
      marketUpdateProposerAddress
    )) as MarketUpdateProposer;

    const cometProxyAdminNew = (await ethers.getContractAt(
      'CometProxyAdmin',
      newCometProxyAdminAddress
    )) as CometProxyAdmin;

    expect(configurator.address).to.be.equal(configuratorProxyAddress);
    expect(await (configurator as Configurator).governor()).to.be.equal(localTimelockAddress);
    expect(await (configurator as Configurator).marketAdminPermissionChecker()).to.be.equal(marketAdminPermissionCheckerAddress);

    expect(await cometProxyAdminNew.marketAdminPermissionChecker()).to.be.equal(marketAdminPermissionChecker.address);
    expect(await cometProxyAdminNew.owner()).to.be.equal(localTimelockAddress);

    expect(await marketAdminPermissionChecker.marketAdmin()).to.be.equal(marketUpdateTimelockAddress);
    expect(await marketAdminPermissionChecker.owner()).to.be.equal(localTimelockAddress);
    expect(await marketAdminPermissionChecker.marketAdminPauseGuardian()).to.be.equal(communityMultiSigAddress);

    expect(await marketUpdateTimelock.marketUpdateProposer()).to.be.equal(marketUpdateProposer.address);
    expect(await marketUpdateTimelock.governor()).to.be.equal(localTimelockAddress);
    expect(await marketUpdateTimelock.delay()).to.be.equal(2 * 24 * 60 * 60);

    expect(await marketUpdateProposer.governor()).to.be.equal(localTimelockAddress);
    expect(await marketUpdateProposer.marketAdmin()).to.be.equal(marketAdminAddress);

    expect(await marketUpdateProposer.timelock()).to.be.equal(marketUpdateTimelock.address);
    expect(await marketUpdateProposer.proposalGuardian()).to.be.equal(communityMultiSigAddress);

    tracer('All checks passed.');
  },
});
