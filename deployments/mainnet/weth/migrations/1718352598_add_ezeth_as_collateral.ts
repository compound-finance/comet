import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const EZETH_ADDRESS = '0xbf5495Efe5DB9ce00f80364C8B423567e58d2110';
const EZETH_PRICE_FEED_ADDRESS = '0x387dBc0fB00b26fb085aa658527D5BE98302c84C';

export default migration('1718352598_add_ezeth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _ezETHScalingPriceFeed = await deploymentManager.deploy(
      'ezETH:priceFeed',
      'pricefeeds/EzETHExchangeRatePriceFeed.sol',
      [
        EZETH_PRICE_FEED_ADDRESS,    // ezETH / ETH exchange rate price feed
        8,                           // decimals
        'ezETH / ETH exchange rate', // description
      ]
    );
    return { ezETHScalingPriceFeed: _ezETHScalingPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { ezETHScalingPriceFeed }) {
    const trace = deploymentManager.tracer();

    const ezETH = await deploymentManager.existing(
      'ezETH',
      EZETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );

    const ezEthPricefeed = await deploymentManager.existing(
      'ezETH:priceFeed',
      ezETHScalingPriceFeed,
      'mainnet'
    );

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const ezETHAssetConfig = {
      asset: ezETH.address,
      priceFeed: ezEthPricefeed.address,
      decimals: await ezETH.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(2_900, 18), 
    };

    const mainnetActions = [
      // 1. Add ezETH as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, ezETHAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add ezETH as collateral into cWETHv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add ezETH into cWETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-market-ezeth-on-eth-mainnet/5062/7).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/874) and [forum discussion](https://www.comp.xyz/t/add-market-ezeth-on-eth-mainnet/5062).\n\n# [Yield Risk](https://www.comp.xyz/t/add-market-ezeth-on-eth-mainnet/5062/7#yield-risk-7)\n\nCurrently LRTs such as ezETH have elevated yields due to points program. EigenLayer maturity and AVS launch will cause yield shocks and consequentially elevate slippage magnitude and liquidity on DEXs. Gauntlet flags this potential risk to the community.\n\n\n## Proposal Actions\n\nThe first proposal action adds ezETH asset as collateral with the corresponding configuration.\n\nThe second action deploys and upgrades Comet to a new version.';
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

    const ezETHAssetIndex = Number(await comet.numAssets()) - 1;

    const ezETH = await deploymentManager.existing(
      'ezETH',
      EZETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );

    const ezETHAssetConfig = {
      asset: ezETH.address,
      priceFeed: '',
      decimals: await ezETH.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(2_900, 18), // 2_900
    };

    // 1. & 2. Compare ezETH asset config with Comet and Configurator asset info
    const cometEzETHAssetInfo = await comet.getAssetInfoByAddress(
      EZETH_ADDRESS
    );

    expect(ezETHAssetIndex).to.be.equal(cometEzETHAssetInfo.offset);
    expect(ezETHAssetConfig.asset).to.be.equal(cometEzETHAssetInfo.asset);
    expect(exp(1, ezETHAssetConfig.decimals)).to.be.equal(
      cometEzETHAssetInfo.scale
    );
    expect(ezETHAssetConfig.borrowCollateralFactor).to.be.equal(
      cometEzETHAssetInfo.borrowCollateralFactor
    );
    expect(ezETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      cometEzETHAssetInfo.liquidateCollateralFactor
    );
    expect(ezETHAssetConfig.liquidationFactor).to.be.equal(
      cometEzETHAssetInfo.liquidationFactor
    );
    expect(ezETHAssetConfig.supplyCap).to.be.equal(
      cometEzETHAssetInfo.supplyCap
    );
    const configuratorEsETHAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[ezETHAssetIndex];
    expect(ezETHAssetConfig.asset).to.be.equal(
      configuratorEsETHAssetConfig.asset
    );
    expect(ezETHAssetConfig.decimals).to.be.equal(
      configuratorEsETHAssetConfig.decimals
    );
    expect(ezETHAssetConfig.borrowCollateralFactor).to.be.equal(
      configuratorEsETHAssetConfig.borrowCollateralFactor
    );
    expect(ezETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      configuratorEsETHAssetConfig.liquidateCollateralFactor
    );
    expect(ezETHAssetConfig.liquidationFactor).to.be.equal(
      configuratorEsETHAssetConfig.liquidationFactor
    );
    expect(ezETHAssetConfig.supplyCap).to.be.equal(
      configuratorEsETHAssetConfig.supplyCap
    );
  },
});
