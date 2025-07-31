import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { Configurator } from './../../../../build/types';
import { expect } from 'chai';
import { proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const gauntletMultiSigAddress = '0xA1C7b6d8b4DeD5ee46330C865cC8aeCfB13c8b65';

const localTimelockAddress = '0x6d903f6003cca6255D85CcA4D3B5E5146dC33925';

const marketUpdateTimelockAddress = '0x67174e10D3DeE790FdaB7eE0cBbAb64093072108';
const marketUpdateProposerAddress = '0x3577D305984931111f2eCb449c91C473C4A985df';
const newConfiguratorImplementationAddress = '0x7cf6d0aD3f4B4BadcE860E7d45641BE790078E08';
const newCometProxyAdminAddress = '0x168097e9aDdC04859934a9C45823a151De6e0471';
const marketAdminPermissionCheckerAddress = '0x68Fb67b0C9A2e7063760287dbe0ec89f7932E13d';

const pauseGuardianAddress = '0xbbf3f1421D886E9b2c5D716B5192aC998af2012c';

const cometProxyAdminOldAddress = '0x1EC63B5883C3481134FD50D5DAebc83Ecd2E8779';
const configuratorProxyAddress = '0x316f9708bB98af7dA9c68C1C3b5e79039cD336E3';
const cometProxyUsdсAddress = '0xc3d688B66703497DAA19211EEdff47f25384cdc3';
const cometProxyUsdsAddress = '0x5D409e56D886231aDAf00c8775665AD0f9897b56';
const cometProxyUsdtAddress = '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840';
const cometProxyWbtcAddress = '0xe85Dc543813B8c2CFEaAc371517b925a166a9293';
const cometProxyWethAddress = '0xA17581A9E3356d9A858b789D68B4d866e593aE94';
const cometProxyWstethAddress = '0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3';

export default migration('1752829095_gov_marketupdates', {
  prepare: async () => {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager
  ) => {
    const trace = deploymentManager.tracer();
    const { governor } = await deploymentManager.getContracts();

    const changeProxyAdminForCometProxyUsdсCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyUsdсAddress, newCometProxyAdminAddress]
    );

    const changeProxyAdminForCometProxyUsdsCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyUsdsAddress, newCometProxyAdminAddress]
    );

    const changeProxyAdminForCometProxyUsdtCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyUsdtAddress, newCometProxyAdminAddress]
    );

    const changeProxyAdminForCometProxyWbtcCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyWbtcAddress, newCometProxyAdminAddress]
    );

    const changeProxyAdminForCometProxyWethCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyWethAddress, newCometProxyAdminAddress]
    );

    const changeProxyAdminForCometProxyWstethCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyWstethAddress, newCometProxyAdminAddress]
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
  
    const actions = [
      // 1. Change proxy admin for USDC Comet
      {
        target: cometProxyAdminOldAddress,
        signature: 'changeProxyAdmin(address,address)',
        calldata: changeProxyAdminForCometProxyUsdсCalldata
      },
      // 2. Change proxy admin for USDS Comet
      {
        target: cometProxyAdminOldAddress,
        signature: 'changeProxyAdmin(address,address)',
        calldata: changeProxyAdminForCometProxyUsdsCalldata
      },
      // 3. Change proxy admin for USDT Comet
      {
        target: cometProxyAdminOldAddress,
        signature: 'changeProxyAdmin(address,address)',
        calldata: changeProxyAdminForCometProxyUsdtCalldata
      },
      // 4. Change proxy admin for WBTC Comet
      {
        target: cometProxyAdminOldAddress,
        signature: 'changeProxyAdmin(address,address)',
        calldata: changeProxyAdminForCometProxyWbtcCalldata
      },
      // 5. Change proxy admin for WETH Comet
      {
        target: cometProxyAdminOldAddress,
        signature: 'changeProxyAdmin(address,address)',
        calldata: changeProxyAdminForCometProxyWethCalldata
      },
      // 6. Change proxy admin for WstETH Comet
      {
        target: cometProxyAdminOldAddress,
        signature: 'changeProxyAdmin(address,address)',
        calldata: changeProxyAdminForCometProxyWstethCalldata
      },
      // 7. Change proxy admin for Configurator Proxy      
      {
        target: cometProxyAdminOldAddress,
        signature: 'changeProxyAdmin(address,address)',
        calldata: changeProxyAdminForConfiguratorProxyCalldata
      },
      // 8. Change implementation for Configurator Proxy
      {
        target: newCometProxyAdminAddress,
        signature: 'upgrade(address,address)',
        calldata: upgradeConfiguratorProxyCalldata
      },
      // 9. Set MarketAdminPermissionChecker for new Configurator Proxy
      {
        target: configuratorProxyAddress,
        signature: 'setMarketAdminPermissionChecker(address)',
        calldata: setMarketAdminPermissionCheckerForConfiguratorProxyCalldata
      },
    ];

    const description = `#Alternate Governance track for Market Updates - Mainnet\n\n##Proposal summary\n
WOOF! proposes an alternate governance track for market updates on the Compound III markets on Mainnet, following the successful deployment by DoDAO on the Optimism network. This proposal aims to streamline market parameter updates by introducing a parallel governance process, reducing friction, and enabling faster updates while maintaining community oversight.

Currently, 70-90% of proposals focus on market parameter updates, which require specialized validation and consume significant community resources (estimated at $300,000 annually). This process diverts attention from critical proposals like new partnerships or asset additions. By granting a market admin role to a Safe address (managed by Gauntlet or community members) and routing updates through a Timelock, the community can review or block changes while speeding up the process.

This proposal was discussed in detail here - https://www.comp.xyz/t/market-updates-alternate-governance-track/5379. OpenZeppelin provided feedback, recommending the Configurator update as the optimal solution. Simulations have confirmed the market’s readiness using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).


##Proposal Actions

The first through sixth actions update the proxy admin for the USDC, USDS, USDT, WBTC, WETH, and wstETH Comet proxies to a new CometProxyAdmin contract.

The seventh action updates the proxy admin for the Configurator proxy to the new CometProxyAdmin contract.

The eighth action upgrades the Configurator proxy to a new implementation.

The ninth action sets the MarketAdminPermissionChecker for the Configurator proxy, enabling the alternate governance track for market updates with a Timelock for community to review or even block the market updates via this alternate route.
`;

    const txn = await deploymentManager.retry(async () =>
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
