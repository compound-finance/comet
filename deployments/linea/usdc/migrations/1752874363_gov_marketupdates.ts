import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { Configurator } from './../../../../build/types';
import { expect } from 'chai';
import { proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const gauntletMultiSigAddress = '0x7e14050080306cd36b47DE61ce604b3a1EC70c4e';

const localTimelockAddress = '0x4A900f81dEdA753bbBab12453b3775D5f26df6F3';

const marketUpdateTimelockAddress = '0x67174e10D3DeE790FdaB7eE0cBbAb64093072108';
const marketUpdateProposerAddress = '0x3577D305984931111f2eCb449c91C473C4A985df';
const newConfiguratorImplementationAddress = '0x7cf6d0aD3f4B4BadcE860E7d45641BE790078E08';
const newCometProxyAdminAddress = '0x168097e9aDdC04859934a9C45823a151De6e0471';
const marketAdminPermissionCheckerAddress = '0x68Fb67b0C9A2e7063760287dbe0ec89f7932E13d';

const pauseGuardianAddress = '0x5A1e5d7E09cA94506084a26304d53A138145bF52';

const cometProxyAdminOldAddress = '0x4b5DeE60531a72C1264319Ec6A22678a4D0C8118';
const configuratorProxyAddress = '0x970FfD8E335B8fa4cd5c869c7caC3a90671d5Dc3';
const cometProxyUsdcAddress = '0x8D38A3d6B3c3B7d96D6536DA7Eef94A9d7dbC991';

export default migration('1752874363_gov_marketupdates', {
  prepare: async () => {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
  ) => {
    const trace = deploymentManager.tracer();
    await deploymentManager.spider();

    const { bridgeReceiver } = await deploymentManager.getContracts();

    const {
      lineaMessageService,
      governor,
    } = await govDeploymentManager.getContracts();


    const changeProxyAdminForCometProxyUsdcCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyUsdcAddress, newCometProxyAdminAddress]
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

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          cometProxyAdminOldAddress,
          cometProxyAdminOldAddress,
          newCometProxyAdminAddress,
          configuratorProxyAddress,
        ],
        [ 0, 0, 0, 0 ],
        [
          'changeProxyAdmin(address,address)',
          'changeProxyAdmin(address,address)',
          'upgrade(address,address)',
          'setMarketAdminPermissionChecker(address)',
        ],
        [
          changeProxyAdminForCometProxyUsdcCalldata,
          changeProxyAdminForConfiguratorProxyCalldata,
          upgradeConfiguratorProxyCalldata,
          setMarketAdminPermissionCheckerForConfiguratorProxyCalldata,
        ],
      ]
    );
  
    const actions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet and set reward config on Linea.
      {
        contract: lineaMessageService,
        signature: 'sendMessage(address,uint256,bytes)',
        args: [bridgeReceiver.address, 0, l2ProposalData],
      },
    ];

    const description = `#Alternate Governance track for Market Updates - Linea\n\n##Proposal summary\n
WOOF! proposes an alternate governance track for market updates on the Compound III markets on Linea, following the successful deployment by DoDAO on the Optimism network. This proposal aims to streamline market parameter updates by introducing a parallel governance process, reducing friction, and enabling faster updates while maintaining community oversight.

Currently, 70-90% of proposals focus on market parameter updates, which require specialized validation and consume significant community resources (estimated at $300,000 annually). This process diverts attention from critical proposals like new partnerships or asset additions. By granting a market admin role to a Safe address (managed by Gauntlet or community members) and routing updates through a Timelock, the community can review or block changes while speeding up the process.

This proposal was discussed in detail here - https://www.comp.xyz/t/market-updates-alternate-governance-track/5379. OpenZeppelin provided feedback, recommending the Configurator update as the optimal solution. Simulations have confirmed the market’s readiness using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).


##Proposal Actions

This proposal executes a single cross-chain action via Linea's 'sendMessage', which forwards encoded instructions to the 'bridgeReceiver' on Linea. The payload contains multiple actions that are executed on L2:

1. Updating the proxy admin for the USDC Comet market to a new 'CometProxyAdmin' contract.
2. Updating the proxy admin for the Configurator proxy to the new 'CometProxyAdmin'.
3. Upgrading the Configurator proxy to a new implementation.
4. Setting the 'MarketAdminPermissionChecker' on the Configurator, enabling an alternate governance track for faster market updates routed through a Timelock for community oversight.

All these actions can be executed on Linea after this relay message is processed.
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
