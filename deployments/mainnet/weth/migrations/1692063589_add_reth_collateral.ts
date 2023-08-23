import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy'

import { expect } from 'chai';

interface Vars {};

export default migration('1692063589_add_reth_collateral', {
  prepare: async (deploymentManager: DeploymentManager) => {
    // Deploy scaling price feed for rETH
    const rETHScalingPriceFeed = await deploymentManager.deploy(
      'rETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        '0x536218f9E9Eb48863970252233c8F271f554C2d0', // rETH / ETH price feed
        8                                             // decimals
      ]
    );
    return { rETHPriceFeedAddress: rETHScalingPriceFeed.address };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, vars: Vars) => {
    const trace = deploymentManager.tracer();

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
      borrowCollateralFactor: exp(0.9, 18),
      liquidateCollateralFactor: exp(0.93, 18),
      liquidationFactor: exp(0.975, 18),
      supplyCap: exp(30000, 18),
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
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      rETH,
      'rETH:priceFeed': rETHPriceFeed
    } = await deploymentManager.getContracts();

    const rethInfo = await comet.getAssetInfoByAddress(rETH.address);

    // check pricefeed
    expect(await rethInfo.priceFeed).to.be.eq(rETHPriceFeed.address);
    expect(await rETHPriceFeed.decimals()).to.be.eq(8);
    // check config
    expect(await rethInfo.borrowCollateralFactor).to.be.eq(exp(0.9, 18));
    expect(await rethInfo.liquidateCollateralFactor).to.be.eq(exp(0.93, 18));
    expect(await rethInfo.liquidationFactor).to.be.eq(exp(0.975, 18));
    expect(await rethInfo.supplyCap).to.be.eq(exp(30_000, 18));
  },
});
