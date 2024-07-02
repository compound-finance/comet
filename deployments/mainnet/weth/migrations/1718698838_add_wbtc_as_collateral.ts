import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';


const WBTC_ADDRESS = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599';
const WBTC_BTC_PRICE_FEED_ADDRESS = '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23';
const BTC_ETH_PRICE_FEED_ADDRESS = '0xdeb288F737066589598e9214E782fa5A8eD689e8';

export default migration('1718698838_add_wbtc_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const wbtcMultiplicativePriceFeed = await deploymentManager.deploy(
      'WBTC:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        WBTC_BTC_PRICE_FEED_ADDRESS,  // WBTC / BTC price feed
        BTC_ETH_PRICE_FEED_ADDRESS,   // BTC / ETH price feed 
        8,                            // decimals
        'WBTC / USD price feed'
      ]
    );
    return { wbtcPriceFeedAddress: wbtcMultiplicativePriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { wbtcPriceFeedAddress }) {
    const trace = deploymentManager.tracer();

    const WBTC = await deploymentManager.existing(
      'WBTC',
      WBTC_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );

    const wbtcPricefeed = await deploymentManager.existing(
      'WBTC:priceFeed',
      wbtcPriceFeedAddress,
      'mainnet'
    );

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const wbtcAssetConfig = {
      asset: WBTC.address,
      priceFeed: wbtcPricefeed.address,
      decimals: await WBTC.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(1_000, 8), 
    };

    const mainnetActions = [
      // 1. Add ezETH as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, wbtcAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add WBTC as collateral into cWETHv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add WBTC into cWETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-wbtc-to-weth-comets-on-ethereum-and-arbitrum/5332/1).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/868) and [forum discussion](https://www.comp.xyz/t/add-wbtc-to-weth-comets-on-ethereum-and-arbitrum/5332).\n\n\n## Proposal Actions\n\nThe first proposal action adds WBTC asset as collateral with the corresponding configuration.\n\nThe second action deploys and upgrades Comet to a new version.';
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

    const wbtcAssetIndex = Number(await comet.numAssets()) - 1;

    const WBTC = await deploymentManager.existing(
      'WBTC',
      WBTC_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    
    const wbtcAssetConfig = {
      asset: WBTC.address,
      priceFeed: '',
      decimals: await WBTC.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(1_000, 8),
    };

    // 1. & 2. Compare WBTC asset config with Comet and Configurator asset info
    const cometWBTCHAssetInfo = await comet.getAssetInfoByAddress(
      WBTC_ADDRESS
    );

    expect(wbtcAssetIndex).to.be.equal(cometWBTCHAssetInfo.offset);
    expect(wbtcAssetConfig.asset).to.be.equal(cometWBTCHAssetInfo.asset);
    expect(exp(1, wbtcAssetConfig.decimals)).to.be.equal(
      cometWBTCHAssetInfo.scale
    );
    expect(wbtcAssetConfig.borrowCollateralFactor).to.be.equal(
      cometWBTCHAssetInfo.borrowCollateralFactor
    );
    expect(wbtcAssetConfig.liquidateCollateralFactor).to.be.equal(
      cometWBTCHAssetInfo.liquidateCollateralFactor
    );
    expect(wbtcAssetConfig.liquidationFactor).to.be.equal(
      cometWBTCHAssetInfo.liquidationFactor
    );
    expect(wbtcAssetConfig.supplyCap).to.be.equal(
      cometWBTCHAssetInfo.supplyCap
    );
    const configuratorEsETHAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wbtcAssetIndex];
    expect(wbtcAssetConfig.asset).to.be.equal(
      configuratorEsETHAssetConfig.asset
    );
    expect(wbtcAssetConfig.decimals).to.be.equal(
      configuratorEsETHAssetConfig.decimals
    );
    expect(wbtcAssetConfig.borrowCollateralFactor).to.be.equal(
      configuratorEsETHAssetConfig.borrowCollateralFactor
    );
    expect(wbtcAssetConfig.liquidateCollateralFactor).to.be.equal(
      configuratorEsETHAssetConfig.liquidateCollateralFactor
    );
    expect(wbtcAssetConfig.liquidationFactor).to.be.equal(
      configuratorEsETHAssetConfig.liquidationFactor
    );
    expect(wbtcAssetConfig.supplyCap).to.be.equal(
      configuratorEsETHAssetConfig.supplyCap
    );
  },
});