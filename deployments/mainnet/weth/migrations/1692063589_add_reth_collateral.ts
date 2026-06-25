import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy'

import { expect } from 'chai';

interface Vars { rETHPriceFeedAddress: string };

// Gauntlet Initial Parameter Recommendations
// https://www.comp.xyz/t/add-reth-as-collateral-to-wethv3-on-mainnet/4498/5
const BORROW_COLLATERAL_FACTOR = exp(0.9, 18);
const LIQUIDATE_COLLATERAL_FACTOR = exp(0.93, 18);
const LIQUIDATION_FACTOR = exp(0.975, 18);
const SUPPLY_CAP = exp(30000, 18);

export default migration('1692063589_add_reth_collateral', {

  prepare: async (deploymentManager: DeploymentManager) => {
    // Deploy scaling price feed for rETH
    const rETHScalingPriceFeed = await deploymentManager.deploy(
      'rETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        '0x536218f9E9Eb48863970252233c8F271f554C2d0', // rETH / ETH Chainlink price feed
        8                                             // decimals
      ]
    );
    return { rETHPriceFeedAddress: rETHScalingPriceFeed.address };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, vars: Vars) => {
    const trace = deploymentManager.tracer();

    // rETH token address
    // https://etherscan.io/token/0xae78736cd615f374d3085123a210448e74fc6393
    const rETH = await deploymentManager.existing('rETH', '0xae78736Cd615f374D3085123A210448E74Fc6393');
    const rETHPricefeed = await deploymentManager.existing('rETH:priceFeed', vars.rETHPriceFeedAddress);

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
    } = await deploymentManager.getContracts();

    const newAssetConfig = {
      asset: rETH.address,
      priceFeed: rETHPricefeed.address,
      decimals: await rETH.decimals(),
      borrowCollateralFactor: BORROW_COLLATERAL_FACTOR,
      liquidateCollateralFactor: LIQUIDATE_COLLATERAL_FACTOR,
      liquidationFactor: LIQUIDATION_FACTOR,
      supplyCap: SUPPLY_CAP,
    };

    const actions = [

      // 1. Call the add asset function on the configurator contract
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, newAssetConfig],
      },

      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },

    ];
    const description = '# Add rETH as Collateral to wETHv3 Mainnet\nSee proposal and parameter recommendations here: https://www.comp.xyz/t/add-reth-as-collateral-to-wethv3-on-mainnet/4498';
    const txn = await deploymentManager.retry(
      async () => governor.propose(...await proposal(actions, description))
    );
    trace(txn);

    const event = (await txn.wait()).events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      rETH,
      'rETH:priceFeed': rETHPriceFeed
    } = await deploymentManager.getContracts();

    const rETHInfo = await comet.getAssetInfoByAddress(rETH.address);

    // check pricefeed
    expect(await rETHInfo.priceFeed).to.be.eq(rETHPriceFeed.address);
    expect(await rETHPriceFeed.decimals()).to.be.eq(8);
    // check config
    expect(await rETHInfo.borrowCollateralFactor).to.be.eq(BORROW_COLLATERAL_FACTOR);
    expect(await rETHInfo.liquidateCollateralFactor).to.be.eq(LIQUIDATE_COLLATERAL_FACTOR);
    expect(await rETHInfo.liquidationFactor).to.be.eq(LIQUIDATION_FACTOR);
    expect(await rETHInfo.supplyCap).to.be.eq(SUPPLY_CAP);
  },
});
