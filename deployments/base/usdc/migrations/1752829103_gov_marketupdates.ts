import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { Configurator } from './../../../../build/types';
import { expect } from 'chai';
import { proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const gauntletMultiSigAddress = '0x7e14050080306cd36b47DE61ce604b3a1EC70c4e';

const localTimelockAddress = '0xCC3E7c85Bb0EE4f09380e041fee95a0caeDD4a02';

const marketUpdateTimelockAddress = '0x67174e10D3DeE790FdaB7eE0cBbAb64093072108';
const marketUpdateProposerAddress = '0x3577D305984931111f2eCb449c91C473C4A985df';
const newConfiguratorImplementationAddress = '0x7cf6d0aD3f4B4BadcE860E7d45641BE790078E08';
const newCometProxyAdminAddress = '0x168097e9aDdC04859934a9C45823a151De6e0471';
const marketAdminPermissionCheckerAddress = '0x68Fb67b0C9A2e7063760287dbe0ec89f7932E13d';

const pauseGuardianAddress = '0x3cb4653F3B45F448D9100b118B75a1503281d2ee';

const cometProxyAdminOldAddress = '0xbdE8F31D2DdDA895264e27DD990faB3DC87b372d';
const configuratorProxyAddress = '0x45939657d1CA34A8FA39A924B71D28Fe8431e581';
const cometProxyUsdcAddress = '0xb125E6687d4313864e53df431d5425969c15Eb2F';
const cometProxyUsdsAddress = '0x2c776041CCFe903071AF44aa147368a9c8EEA518';
const cometProxyWethAddress = '0x46e6b214b524310239732D51387075E0e70970bf';
const cometProxyUsdbcAddress = '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf';
const cometProxyAeroAddress = '0x784efeB622244d2348d4F2522f8860B96fbEcE89';

export default migration('1752829103_gov_marketupdates', {
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
      baseL1CrossDomainMessenger,
      governor,
    } = await govDeploymentManager.getContracts();


    const changeProxyAdminForCometProxyUsdcCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyUsdcAddress, newCometProxyAdminAddress]
    );

    const changeProxyAdminForCometProxyUsdsCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyUsdsAddress, newCometProxyAdminAddress]
    );

    const changeProxyAdminForCometProxyWethCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyWethAddress, newCometProxyAdminAddress]
    );

    const changeProxyAdminForConfiguratorProxyCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configuratorProxyAddress, newCometProxyAdminAddress]
    );

    const changeProxyAdminForCometProxyUsdbcCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyUsdbcAddress, newCometProxyAdminAddress]
    );

    const changeProxyAdminForCometProxyAeroCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyAeroAddress, newCometProxyAdminAddress]
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
          cometProxyAdminOldAddress,
          cometProxyAdminOldAddress,
          cometProxyAdminOldAddress,
          cometProxyAdminOldAddress,
          newCometProxyAdminAddress,
          configuratorProxyAddress,
        ],
        [ 0, 0, 0, 0, 0, 0, 0, 0 ],
        [
          'changeProxyAdmin(address,address)',
          'changeProxyAdmin(address,address)',
          'changeProxyAdmin(address,address)',
          'changeProxyAdmin(address,address)',
          'changeProxyAdmin(address,address)',
          'changeProxyAdmin(address,address)',
          'upgrade(address,address)',
          'setMarketAdminPermissionChecker(address)',
        ],
        [
          changeProxyAdminForCometProxyUsdcCalldata,
          changeProxyAdminForCometProxyUsdsCalldata,
          changeProxyAdminForCometProxyWethCalldata,
          changeProxyAdminForCometProxyUsdbcCalldata,
          changeProxyAdminForCometProxyAeroCalldata,
          changeProxyAdminForConfiguratorProxyCalldata,
          upgradeConfiguratorProxyCalldata,
          setMarketAdminPermissionCheckerForConfiguratorProxyCalldata,
        ],
      ]
    );
  
    const actions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet and set reward config on Base.
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },
    ];

    const description = `#Alternate Governance track for Market Updates - Base\n\n##Proposal summary\n
WOOF! proposes an alternate governance track for market updates on the Compound III markets on Base, following the successful deployment by DoDAO on the Optimism network. This proposal aims to streamline market parameter updates by introducing a parallel governance process, reducing friction, and enabling faster updates while maintaining community oversight.

Currently, 70-90% of proposals focus on market parameter updates, which require specialized validation and consume significant community resources (estimated at $300,000 annually). This process diverts attention from critical proposals like new partnerships or asset additions. By granting a market admin role to a Safe address (managed by Gauntlet or community members) and routing updates through a Timelock, the community can review or block changes while speeding up the process.

This proposal was discussed in detail here - https://www.comp.xyz/t/market-updates-alternate-governance-track/5379. OpenZeppelin provided feedback, recommending the Configurator update as the optimal solution. Simulations have confirmed the market’s readiness using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).


##Proposal Actions

This proposal executes a single cross-chain action via Base's 'sendMessage', which forwards encoded instructions to the 'bridgeReceiver' on Base. The payload contains multiple actions that are executed on L2:

1. Updating the proxy admin for the USDC, USDS, WETH, USDbC and AERO Comet markets to a new 'CometProxyAdmin' contract.
2. Updating the proxy admin for the Configurator proxy to the new 'CometProxyAdmin'.
3. Upgrading the Configurator proxy to a new implementation.
4. Setting the 'MarketAdminPermissionChecker' on the Configurator, enabling an alternate governance track for faster market updates routed through a Timelock for community oversight.

All these actions can be executed on Base after this relay message is processed.
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
