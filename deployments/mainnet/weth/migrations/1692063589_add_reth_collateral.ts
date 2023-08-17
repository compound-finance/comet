import { debug } from 'console';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy'

import { expect } from 'chai';

interface Vars {};

export default migration('1692063589_add_reth_collateral', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (governanceDeploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, vars: Vars) => {
    const trace = governanceDeploymentManager.tracer();

    const reth = await governanceDeploymentManager.existing('rETH', '0xae78736Cd615f374D3085123A210448E74Fc6393');
    const rethPricefeed = await governanceDeploymentManager.existing('rETH:priceFeed', '0x536218f9E9Eb48863970252233c8F271f554C2d0');

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
    } = await governanceDeploymentManager.getContracts();

    const newAssetConfig = {
      asset: reth.address,
      priceFeed: rethPricefeed.address,
      decimals: await reth.decimals(),
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
    const description = "# Add rETH as Collateral to wETHv3 Mainnet\nThis proposal adds rETH as collateral.\n";
    const txn = await governanceDeploymentManager.retry(
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
      reth,
    } = await deploymentManager.getContracts();

    const rethInfo = await comet.getAssetInfoByAddress(reth.address);

    // priceFeed: rethPricefeed.address,
    //   decimals: await reth.decimals(),
    //   borrowCollateralFactor: exp(0.9, 18),
    //   liquidateCollateralFactor: exp(0.93, 18),
    //   liquidationFactor: exp(0.975, 18),
    expect(await rethInfo.supplyCap).to.be.eq(exp(30_000, 18));
  },
});
