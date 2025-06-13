import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const ETHX_ADDRESS = '0xA35b1B31Ce002FBF2058D22F30f95D405200A15b';
const ETHX_PRICE_FEED_ADDRESS = '0xdd487947c579af433AeeF038Bf1573FdBB68d2d3';

export default migration('1730466050_add_ethx_as_collaterals', {
  async prepare(deploymentManager: DeploymentManager) {
    const _ETHxScalingPriceFeed = await deploymentManager.deploy(
      'ETHx:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        ETHX_PRICE_FEED_ADDRESS,  // ETHx / ETH price feed
        8                         // decimals
      ],
      true
    );

    return { ETHxScalingPriceFeed: _ETHxScalingPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { ETHxScalingPriceFeed }) {

    const trace = deploymentManager.tracer();

    const ETHx = await deploymentManager.existing(
      'ETHx',
      ETHX_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const ETHxPricefeed = await deploymentManager.existing(
      'ETHx:priceFeed',
      ETHxScalingPriceFeed,
      'mainnet'
    );

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const ETHxAssetConfig = {
      asset: ETHx.address,
      priceFeed: ETHxPricefeed.address,
      decimals: await ETHx.decimals(),
      borrowCollateralFactor: exp(0.85, 18),
      liquidateCollateralFactor: exp(0.90, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(2_100, 18),
    };

    const mainnetActions = [
      // 1. Add ETHx as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, ETHxAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add ETHx as collaterals into cWETHv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add ETHx into cWETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/listing-ethx-on-compound/4730/21).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/901) and [forum discussion](https://www.comp.xyz/t/listing-ethx-on-compound/4730).\n\n\n## Price feed\n\nExchange rate price feed of ETHx/ETH was provided by Chainlink team. The address of pricefeed that is used is 0xdd487947c579af433AeeF038Bf1573FdBB68d2d3\n\n\n## Proposal Actions\n\nThe first proposal action adds ETHx asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';
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

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const ETHxAssetIndex = Number(await comet.numAssets()) - 1;

    const ETHx = await deploymentManager.existing(
      'ETHx',
      ETHX_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const ETHxAssetConfig = {
      asset: ETHx.address,
      priceFeed: '',
      decimals: await ETHx.decimals(),
      borrowCollateralFactor: exp(0.85, 18),
      liquidateCollateralFactor: exp(0.90, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(2_100, 18),
    };

    // 1. Compare ETHx asset config with Comet and Configurator asset info
    const cometETHxAssetInfo = await comet.getAssetInfo(ETHxAssetIndex);
    expect(ETHxAssetIndex).to.be.equal(cometETHxAssetInfo.offset);
    expect(ETHxAssetConfig.asset).to.be.equal(cometETHxAssetInfo.asset);
    expect(exp(1, ETHxAssetConfig.decimals)).to.be.equal(cometETHxAssetInfo.scale);
    expect(ETHxAssetConfig.borrowCollateralFactor).to.be.equal(cometETHxAssetInfo.borrowCollateralFactor);
    expect(ETHxAssetConfig.liquidateCollateralFactor).to.be.equal(cometETHxAssetInfo.liquidateCollateralFactor);
    expect(ETHxAssetConfig.liquidationFactor).to.be.equal(cometETHxAssetInfo.liquidationFactor);
    expect(ETHxAssetConfig.supplyCap).to.be.equal(cometETHxAssetInfo.supplyCap);

    const configuratorETHxAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[ETHxAssetIndex];
    expect(ETHxAssetConfig.asset).to.be.equal(configuratorETHxAssetConfig.asset);
    expect(ETHxAssetConfig.decimals).to.be.equal(configuratorETHxAssetConfig.decimals);
    expect(ETHxAssetConfig.borrowCollateralFactor).to.be.equal(configuratorETHxAssetConfig.borrowCollateralFactor);
    expect(ETHxAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorETHxAssetConfig.liquidateCollateralFactor);
    expect(ETHxAssetConfig.liquidationFactor).to.be.equal(configuratorETHxAssetConfig.liquidationFactor);
    expect(ETHxAssetConfig.supplyCap).to.be.equal(configuratorETHxAssetConfig.supplyCap);
  },
});