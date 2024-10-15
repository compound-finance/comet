import { expect } from 'chai';

import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

interface Vars { };

const BORROW_COLLATERAL_FACTOR = exp(0.85, 18);
const LIQUIDATE_COLLATERAL_FACTOR = exp(0.90, 18);
const LIQUIDATION_FACTOR = exp(0.95, 18);
const SUPPLY_CAP = exp(2100, 18);

const ETHX_ADDRESS = '0xA35b1B31Ce002FBF2058D22F30f95D405200A15b';
const ETHX_PRICE_FEED_ADDRESS = '0x8e0fb51a7383d3894b97169922bdf8c2e88b43eb';

export default migration('1715192704_add_ethx_collateral', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, vars: Vars) => {
    const trace = deploymentManager.tracer();

    const ethx = await deploymentManager.existing(
      'ETHX',
      ETHX_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const ethxPricefeed = await deploymentManager.existing(
      'ETHX:priceFeed',
      ETHX_PRICE_FEED_ADDRESS,
      'mainnet'
    );

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
    } = await deploymentManager.getContracts();

    const newAssetConfig = {
      asset: ethx.address,
      priceFeed: ethxPricefeed.address,
      decimals: await ethx.decimals(),
      borrowCollateralFactor: BORROW_COLLATERAL_FACTOR,
      liquidateCollateralFactor: LIQUIDATE_COLLATERAL_FACTOR,
      liquidationFactor: LIQUIDATION_FACTOR,
      supplyCap: SUPPLY_CAP,
    };

    const actions = [
      // 1. Call the add asset function on the configurator contract
      {
        contract: configurator,
        signature:
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, newAssetConfig],
      },

      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = "# Add ETHx as collateral for cWETHv3 on mainnet\n\nProposal summary\n\nStader Labs proposes to add ETHx as collateral for cWETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Ethereum. Upon execution, ETHx will be ready for use.  Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/851) and [forum discussion](https://www.comp.xyz/t/listing-ethx-on-compound/4730).\n\n## Proposal Actions\n\nThe first proposal action adds ETHx asset as collateral with corresponding configuration.\n\nThe second proposal action deploys and upgrades the version of Comet.\n\n";
    const txn = await deploymentManager.retry(async () =>
      governor.propose(...(await proposal(actions, description)))
    );
    trace(txn);

    const event = (await txn.wait()).events.find(
      (event) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet } = await deploymentManager.getContracts();

    const ethxInfo = await comet.getAssetInfoByAddress(ETHX_ADDRESS);

    // check pricefeed
    expect(await ethxInfo.priceFeed).to.be.eq(ETHX_PRICE_FEED_ADDRESS);
    // check config
    expect(await ethxInfo.borrowCollateralFactor).to.be.eq(
      BORROW_COLLATERAL_FACTOR
    );
    expect(await ethxInfo.liquidateCollateralFactor).to.be.eq(
      LIQUIDATE_COLLATERAL_FACTOR
    );
    expect(await ethxInfo.liquidationFactor).to.be.eq(LIQUIDATION_FACTOR);
    expect(await ethxInfo.supplyCap).to.be.eq(SUPPLY_CAP);
  },
});
