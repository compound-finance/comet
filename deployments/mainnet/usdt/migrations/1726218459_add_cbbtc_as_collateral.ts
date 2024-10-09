import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const CBBTC_ADDRESS = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const CBBTC_USD_PRICE_FEED = '0x2665701293fCbEB223D11A08D826563EDcCE423A';

let priceFeedAddress: string;

export default migration('1726218459_add_cbbtc_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _cbBTCPriceFeed = await deploymentManager.deploy(
      'cbBTC:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        CBBTC_USD_PRICE_FEED, // cbBTC / USD price feed
        8                     // decimals
      ]
    );
    return { cbBTCPriceFeedAddress: _cbBTCPriceFeed.address };
  },

  enact: async (deploymentManager: DeploymentManager, _, { cbBTCPriceFeedAddress }) => {
    const trace = deploymentManager.tracer();

    const cbBTC = await deploymentManager.existing(
      'cbBTC',
      CBBTC_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const cbBTCPriceFeed = await deploymentManager.existing(
      'cbBTC:priceFeed',
      cbBTCPriceFeedAddress,
      'mainnet'
    );
    priceFeedAddress = cbBTCPriceFeed.address;
    const {
      governor,
      comet,
      cometAdmin,
      configurator
    } = await deploymentManager.getContracts();

    const newAssetConfig = {
      asset: cbBTC.address,
      priceFeed: cbBTCPriceFeed.address,
      decimals: await cbBTC.decimals(),
      borrowCollateralFactor: exp(0.8, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(93, 8),
    };

    const mainnetActions = [
      // 1. Add cbBTC as asset
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

    const description = '# Add cbBTC as collateral into cUSDTv3 on Ethereum\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add cbBTC into cUSDTv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDT market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-collateral-cbbtc-to-weth-market-on-base-and-mainnet/5689/2).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/922) and [forum discussion](https://www.comp.xyz/t/add-collateral-cbbtc-to-weth-market-on-base-and-mainnet/5689).\n\n\n## Proposal Actions\n\nThe first proposal action adds cbBTC asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';
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

    const cbBTCAssetIndex = Number(await comet.numAssets()) - 1;

    const cbBTCAssetConfig = {
      asset: CBBTC_ADDRESS,
      priceFeed: priceFeedAddress,
      decimals: 8,
      borrowCollateralFactor: exp(0.8, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(93, 8),
    };

    // 1. Compare proposed asset config with Comet asset info
    const cbBTCAssetInfo = await comet.getAssetInfoByAddress(CBBTC_ADDRESS);
    expect(cbBTCAssetIndex).to.be.equal(cbBTCAssetInfo.offset);
    expect(cbBTCAssetConfig.asset).to.be.equal(cbBTCAssetInfo.asset);
    expect(cbBTCAssetConfig.priceFeed).to.be.equal(cbBTCAssetInfo.priceFeed);
    expect(exp(1, cbBTCAssetConfig.decimals)).to.be.equal(cbBTCAssetInfo.scale);
    expect(cbBTCAssetConfig.borrowCollateralFactor).to.be.equal(cbBTCAssetInfo.borrowCollateralFactor);
    expect(cbBTCAssetConfig.liquidateCollateralFactor).to.be.equal(cbBTCAssetInfo.liquidateCollateralFactor);
    expect(cbBTCAssetConfig.liquidationFactor).to.be.equal(cbBTCAssetInfo.liquidationFactor);
    expect(cbBTCAssetConfig.supplyCap).to.be.equal(cbBTCAssetInfo.supplyCap);

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorcbBTCAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[cbBTCAssetIndex];
    expect(cbBTCAssetConfig.asset).to.be.equal(configuratorcbBTCAssetConfig.asset);
    expect(cbBTCAssetConfig.priceFeed).to.be.equal(configuratorcbBTCAssetConfig.priceFeed);
    expect(cbBTCAssetConfig.decimals).to.be.equal(configuratorcbBTCAssetConfig.decimals);
    expect(cbBTCAssetConfig.borrowCollateralFactor).to.be.equal(configuratorcbBTCAssetConfig.borrowCollateralFactor);
    expect(cbBTCAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorcbBTCAssetConfig.liquidateCollateralFactor);
    expect(cbBTCAssetConfig.liquidationFactor).to.be.equal(configuratorcbBTCAssetConfig.liquidationFactor);
    expect(cbBTCAssetConfig.supplyCap).to.be.equal(configuratorcbBTCAssetConfig.supplyCap);
  },
});
