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
import { proposal } from '../../../../src/deploy';

const gauntletMultiSigAddress = '0x7e14050080306cd36b47DE61ce604b3a1EC70c4e';

const localTimelockAddress = '0x2F4eAF29dfeeF4654bD091F7112926E108eF4Ed0';

const marketUpdateTimelockAddress = '0x67174e10D3DeE790FdaB7eE0cBbAb64093072108';
const marketUpdateProposerAddress = '0x3577D305984931111f2eCb449c91C473C4A985df';
const newConfiguratorImplementationAddress = '0x7cf6d0aD3f4B4BadcE860E7d45641BE790078E08';
const newCometProxyAdminAddress = '0x168097e9aDdC04859934a9C45823a151De6e0471';
const marketAdminPermissionCheckerAddress = '0x68Fb67b0C9A2e7063760287dbe0ec89f7932E13d';

const pauseGuardianAddress = '0x6784FC9e931D7d5B1075e665A4016c299ee6C31B';

const cometProxyAdminOldAddress = '0xaeB318360f27748Acb200CE616E389A6C9409a07';
const configuratorProxyAddress = '0x8df378453Ff9dEFFa513367CDF9b3B53726303e9';
const cometProxyUsdcAddress = '0x2c7118c4C88B9841FCF839074c26Ae8f035f2921';
const cometProxyWethAddress = '0x6C987dDE50dB1dcDd32Cd4175778C2a291978E2a';

export default migration('1752654094_gov_marketupdates', {
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

    const {
      unichainL1CrossDomainMessenger,
      governor,
    } = await govDeploymentManager.getContracts();


    const changeProxyAdminForCometProxyUsdcCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyUsdcAddress, newCometProxyAdminAddress]
    );

    const changeProxyAdminForCometProxyWethCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyWethAddress, newCometProxyAdminAddress]
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
          cometProxyAdminOldAddress,
          newCometProxyAdminAddress,
          configuratorProxyAddress,
        ],
        [0, 0, 0, 0, 0],
        [
          'changeProxyAdmin(address,address)',
          'changeProxyAdmin(address,address)',
          'changeProxyAdmin(address,address)',
          'upgrade(address,address)',
          'setMarketAdminPermissionChecker(address)',
        ],
        [
          changeProxyAdminForCometProxyUsdcCalldata,
          changeProxyAdminForCometProxyWethCalldata,
          changeProxyAdminForConfiguratorProxyCalldata,
          upgradeConfiguratorProxyCalldata,
          setMarketAdminPermissionCheckerForConfiguratorProxyCalldata,
        ],
      ]
    );
  
    const actions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet and set reward config on Unichain.
      {
        contract: unichainL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000],
      },
    ];

    const description = `DESCRIPTION`;

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
