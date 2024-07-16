import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const WSTETH_ADDRESS = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
const STETH_USD_PRICE_FEED_ADDRESS = '0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8';
let newPriceFeedAddress: string;

export default migration('1720623615_add_wsteth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _wstETHScalingPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'pricefeeds/WstETHPriceFeed.sol',
      [
        STETH_USD_PRICE_FEED_ADDRESS,   // stETH / USD price feed
        WSTETH_ADDRESS,                 // wstETH address
        8                               // decimals
      ]
    );
    return { wstETHScalingPriceFeed: _wstETHScalingPriceFeed.address };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    _,
    { wstETHScalingPriceFeed }
  ) => {
    const trace = deploymentManager.tracer();

    const wstETH = await deploymentManager.existing(
      'wstETH',
      WSTETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const wstETHPricefeed = await deploymentManager.existing(
      'wstETH:priceFeed',
      wstETHScalingPriceFeed,
      'mainnet'
    );

    const {
      governor,
      comet,
      cometAdmin,
      configurator
    } = await deploymentManager.getContracts();

    const newAssetConfig = {
      asset: wstETH.address,
      priceFeed: wstETHPricefeed.address,
      decimals: await wstETH.decimals(),
      borrowCollateralFactor: exp(0.82, 18),
      liquidateCollateralFactor: exp(0.87, 18),
      liquidationFactor: exp(0.92, 18),
      supplyCap: exp(15_000, 18),
    };

    newPriceFeedAddress = wstETHPricefeed.address;

    const mainnetActions = [
      // 1. Add weETH as asset
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
    
    const description = '# Add wstETH as collateral into cUSDCv3 on Ethereum\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add wstETH into cUSDCv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDC market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/gauntlet-wsteth-and-ezeth-asset-listing/5404/1).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/884) and [forum discussion](https://www.comp.xyz/t/gauntlet-wsteth-and-ezeth-asset-listing/5404).\n\n\n## Proposal Actions\n\nThe first proposal action adds wstETH asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';
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
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const wstETHAssetIndex = Number(await comet.numAssets()) - 1;

    const wstETHAssetConfig = {
      asset: WSTETH_ADDRESS,
      priceFeed: newPriceFeedAddress,
      decimals: 18,
      borrowCollateralFactor: exp(0.82, 18),
      liquidateCollateralFactor: exp(0.87, 18),
      liquidationFactor: exp(0.92, 18),
      supplyCap: exp(15_000, 18),
    };

    // 1. Compare proposed asset config with Comet asset info
    const wstETHAssetInfo = await comet.getAssetInfoByAddress(
      WSTETH_ADDRESS
    );
    expect(wstETHAssetIndex).to.be.equal(wstETHAssetInfo.offset);
    expect(wstETHAssetConfig.asset).to.be.equal(wstETHAssetInfo.asset);
    expect(wstETHAssetConfig.priceFeed).to.be.equal(
      wstETHAssetInfo.priceFeed
    );
    expect(exp(1, wstETHAssetConfig.decimals)).to.be.equal(
      wstETHAssetInfo.scale
    );
    expect(wstETHAssetConfig.borrowCollateralFactor).to.be.equal(
      wstETHAssetInfo.borrowCollateralFactor
    );
    expect(wstETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      wstETHAssetInfo.liquidateCollateralFactor
    );
    expect(wstETHAssetConfig.liquidationFactor).to.be.equal(
      wstETHAssetInfo.liquidationFactor
    );
    expect(wstETHAssetConfig.supplyCap).to.be.equal(
      wstETHAssetInfo.supplyCap
    );

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorWstETHAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wstETHAssetIndex];
    expect(wstETHAssetConfig.asset).to.be.equal(
      configuratorWstETHAssetConfig.asset
    );
    expect(wstETHAssetConfig.priceFeed).to.be.equal(
      configuratorWstETHAssetConfig.priceFeed
    );
    expect(wstETHAssetConfig.decimals).to.be.equal(
      configuratorWstETHAssetConfig.decimals
    );
    expect(wstETHAssetConfig.borrowCollateralFactor).to.be.equal(
      configuratorWstETHAssetConfig.borrowCollateralFactor
    );
    expect(wstETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      configuratorWstETHAssetConfig.liquidateCollateralFactor
    );
    expect(wstETHAssetConfig.liquidationFactor).to.be.equal(
      configuratorWstETHAssetConfig.liquidationFactor
    );
    expect(wstETHAssetConfig.supplyCap).to.be.equal(
      configuratorWstETHAssetConfig.supplyCap
    );
  },
});
