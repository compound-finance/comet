import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const WSTETH_ADDRESS = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
const constantPriceFeedAddress = '0x72e9B6F907365d76C6192aD49C0C5ba356b7Fa48';

export default migration('1727727546_change_base_price_feed', {
  async prepare() {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const {
      governor,
      comet,
      cometAdmin,
      configurator
    } = await deploymentManager.getContracts();


    const mainnetActions = [
      // 1. Add weETH as asset
      {
        contract: configurator,
        signature: 'setBaseTokenPriceFeed(address,address)',
        args: [comet.address, constantPriceFeedAddress],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Update price feed in cWstETHv3 on Ethereum\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to update wstETH price feed in cWstETHv3 market on Ethereum to constant price feed as it is intended to be.\n\n\n## Proposal Actions\n\nThe first proposal action updates price feed for wstETH.\n\nThe second action deploys and upgrades Comet to a new version.';
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      )
    );

    const event = txn.events.find(
      (event) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    // 1. Compare proposed asset config with Comet asset info
    const basePriceFeed = await comet.baseTokenPriceFeed();

    expect(basePriceFeed).to.eq(constantPriceFeedAddress);
    expect(await comet.getPrice(basePriceFeed)).to.eq(exp(1, 8));

    // 2. Compare proposed asset config with Configurator asset config
    const basePriceFeedFromConfigurator = (
      await configurator.getConfiguration(comet.address)
    ).baseTokenPriceFeed;
    
    expect(basePriceFeedFromConfigurator).to.eq(constantPriceFeedAddress);
  },
});
