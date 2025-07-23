import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { Configurator } from './../../../../build/types';
import { expect } from 'chai';
import { exp, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const marketAdminAddress = '0x7e14050080306cd36b47DE61ce604b3a1EC70c4e';

const localTimelockAddress = '0xF6013e80E9e6AC211Cc031ad1CE98B3Aa20b73E4';

const marketUpdateTimelockAddress = '0x67174e10D3DeE790FdaB7eE0cBbAb64093072108';
const marketUpdateProposerAddress = '0x3577D305984931111f2eCb449c91C473C4A985df';
const newConfiguratorImplementationAddress = '0x7cf6d0aD3f4B4BadcE860E7d45641BE790078E08';
const newCometProxyAdminAddress = '0x168097e9aDdC04859934a9C45823a151De6e0471';
const marketAdminPermissionCheckerAddress = '0x68Fb67b0C9A2e7063760287dbe0ec89f7932E13d';

const communityMultiSigAddress = '0x0747a435b8a60070A7a111D015046d765098e4cc';

const cometProxyAdminOldAddress = '0x87A27b91f4130a25E9634d23A5B8E05e342bac50';
const configuratorProxyAddress = '0xECAB0bEEa3e5DEa0c35d3E69468EAC20098032D7';
const cometProxyAddress = '0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44';

export default migration('1752829057_gov_market_updates', {
  prepare: async () => {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
  ) => {
    const trace = deploymentManager.tracer();

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
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet and set reward config on Scroll.
      {
        contract: scrollMessenger,
        signature: 'sendMessage(address,uint256,bytes,uint256)',
        args: [bridgeReceiver.address, 0, l2ProposalData, 6_000_000],
        value: exp(0.1, 18),
      },
    ];

    const description = `#Alternate Governance track for Market Updates - Scroll\n\n##Proposal summary\n
WOOF! proposes an alternate governance track for market updates on the Compound III markets on Scroll, following the successful deployment by DoDAO on the Optimism network. This proposal aims to streamline market parameter updates by introducing a parallel governance process, reducing friction, and enabling faster updates while maintaining community oversight.

Currently, 70-90% of proposals focus on market parameter updates, which require specialized validation and consume significant community resources (estimated at $300,000 annually). This process diverts attention from critical proposals like new partnerships or asset additions. By granting a market admin role to a Safe address (managed by Gauntlet or community members) and routing updates through a Timelock, the community can review or block changes while speeding up the process.

This proposal was discussed in detail here - https://www.comp.xyz/t/market-updates-alternate-governance-track/5379. OpenZeppelin provided feedback, recommending the Configurator update as the optimal solution. Simulations have confirmed the market’s readiness using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).


##Proposal Actions

This proposal executes a single cross-chain action via Scroll's 'sendMessage', which forwards encoded instructions to the 'bridgeReceiver' on Scroll. The payload contains multiple actions that are executed on L2:

1. Updating the proxy admin for the USDC Comet market to a new 'CometProxyAdmin' contract.
2. Updating the proxy admin for the Configurator proxy to the new 'CometProxyAdmin'.
3. Upgrading the Configurator proxy to a new implementation.
4. Setting the 'MarketAdminPermissionChecker' on the Configurator, enabling an alternate governance track for faster market updates routed through a Timelock for community oversight.

All these actions can be executed on Scroll after this relay message is processed.
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
    await deploymentManager.spider();
    const tracer = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

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
