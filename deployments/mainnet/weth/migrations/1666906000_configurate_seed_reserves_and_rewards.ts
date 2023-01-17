import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

const cETHAddress = '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5';
const COMPAddress = '0xc00e94cb662c3520282e6f5717214004a7f26888';

export default migration('1666906000_configurate_seed_reserves_and_rewards', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const comptrollerV2 = await deploymentManager.fromDep('comptrollerV2', 'mainnet', 'usdc');
    const cometFactory = await deploymentManager.fromDep('cometFactory', 'mainnet', 'usdc');
    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      rewards,
      WETH,
      wstETH,
      cbETH,
    } = await deploymentManager.getContracts();

    const configuration = await getConfigurationStruct(deploymentManager);

    const actions = [
      // 1. Set v2 cETH speeds to 0
      {
        contract: comptrollerV2,
        signature: '_setCompSpeeds(address[],uint256[],uint256[])',
        args: [[cETHAddress], [0], [0]],
      },

      // 2. Set the factory in the Configurator
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [comet.address, cometFactory.address],
      },

      // 3. Set the configuration in the Configurator
      {
        contract: configurator,
        signature: 'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
        args: [comet.address, configuration],
      },

      // 4. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: "deployAndUpgradeTo(address,address)",
        args: [configurator.address, comet.address],
      },

      // 5. Set the rewards configuration to COMP
      {
        contract: rewards,
        signature: "setRewardConfig(address,address)",
        args: [comet.address, COMPAddress],
      },

      // 6. Wrap some ETH as WETH
      {
        contract: WETH,
        signature: "deposit()",
        args: [],
        value: 358052565869157684316n, // 500e18 - current balance
      },

      // 7. Send all Timelock's WETH to Comet to seed reserves
      {
        contract: WETH,
        signature: "transfer(address,uint256)",
        args: [comet.address, exp(500, 18)],
      },

      // 8. Transfer COMP
      {
        contract: comptrollerV2,
        signature: '_grantComp(address,uint256)',
        args: [rewards.address, exp(25_000, 18)],
      },
    ];
    const description = "# Initialize cWETHv3 on Ethereum\n\nThis proposal takes the governance steps recommended and necessary to initialize a Compound III WETH market; upon execution, cWETHv3 will be ready for use. Simulations have confirmed the market\u2019s readiness, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).\n\nAlthough the proposal sets the entire configuration in the Configurator, the initial deployment already has most of these same parameters already set. This proposal initializes the market with a supply cap of 64,500 wstETH and 7,100 cbETH, and 38.7 COMP per day allocated to WETH suppliers.\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/608) and [forum discussion](https://www.comp.xyz/t/initialize-compound-iii-weth-on-ethereum/3737).\n\n\n## Proposal Actions\n\nThe first proposal action sets the cETH(v2) COMP reward speeds to zero in the Comptroller.\n\nThe second action sets the CometFactory for the new Comet instance in the existing Configurator.\n\nThe third action configures the Comet instance in the Configurator.\n\nThe fourth action deploys an instance of the newly configured factory and upgrades the Comet instance to use that implementation.\n\nThe fifth action configures the existing rewards contract for the newly deployed Comet instance.\n\nThe sixth and sevenths actions are to wrap ~358.05 ETH from the Timelock, and transfer the full balance of 500 WETH to the new Comet instance, in order to seed reserves.\n\nThe eighth action is to transfer 25,000 an additional COMP to the v3 rewards contract, in order to refresh its supply.\n";
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const cometFactory = await deploymentManager.fromDep('cometFactory', 'mainnet', 'usdc');
    const {
      timelock,
      comptrollerV2,
      comet,
      configurator,
      rewards,
      COMP,
      WETH,
      wstETH,
      cbETH,
    } = await deploymentManager.getContracts();

    // 1.
    expect(await comptrollerV2.compSupplySpeeds(cETHAddress)).to.be.equal(0);
    expect(await comptrollerV2.compBorrowSpeeds(cETHAddress)).to.be.equal(0);

    // 2.
    expect(await configurator.factory(comet.address)).to.be.equal(cometFactory.address);

    // 3. & 4.
    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(exp(38.7 / 86400, 15, 18)); // ~ 38.7 COMP / day cut from v2
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(0);

    const wstETHInfo = await comet.getAssetInfoByAddress(wstETH.address);
    expect(wstETHInfo.supplyCap).to.be.equal(exp(64_500, 18)); // ~ $100M / $1550

    const cbETHInfo = await comet.getAssetInfoByAddress(cbETH.address);
    expect(cbETHInfo.supplyCap).to.be.equal(exp(7_100, 18)); // ~ $10M / $1400

    // other initial params:
    expect(await comet.supplyKink()).to.be.equal(900000000000000000n);
    expect(await comet.supplyPerSecondInterestRateBase()).to.be.equal(0n);
    expect(await comet.supplyPerSecondInterestRateSlopeLow()).to.be.equal(900000000n);
    expect(await comet.supplyPerSecondInterestRateSlopeHigh()).to.be.equal(19236960001n);

    expect(await comet.borrowKink()).to.be.equal(900000000000000000n);
    expect(await comet.borrowPerSecondInterestRateBase()).to.be.equal(315360529n);
    expect(await comet.borrowPerSecondInterestRateSlopeLow()).to.be.equal(1639871893n);
    expect(await comet.borrowPerSecondInterestRateSlopeHigh()).to.be.equal(16398719999n);

    // 5.
    const config = await rewards.rewardConfig(comet.address);
    expect(config.token.toLowerCase()).to.be.equal(COMPAddress);
    expect(config.rescaleFactor).to.be.equal(1000000000000n);
    expect(config.shouldUpscale).to.be.equal(true);

    // 6. & 7.
    expect(await WETH.balanceOf(timelock.address)).to.be.equal(0);
    expect(await WETH.balanceOf(comet.address)).to.be.equal(exp(500, 18));
    expect(await comet.getReserves()).to.be.equal(exp(500, 18));

    // 8.
    expect(await COMP.balanceOf(rewards.address)).to.be.greaterThan(exp(25_000, 18));
  },
});
