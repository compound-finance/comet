import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const TBTC_ADDRESS = '0x18084fbA666a33d37592fA2633fD49a74DD93a88';
const TBTC_TO_USD_PRICE_FEED = '0x8350b7De6a6a2C1368E7D4Bd968190e13E354297';

let newPriceFeedAddress: string;

export default migration('1728054806_add_tbtc_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const tBTCMultiplicativePriceFeed = await deploymentManager.deploy(
      'tBTC:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        TBTC_TO_USD_PRICE_FEED,   // tBTC / USD price feed
        8,                        // decimals
      ]
    );
    return { tBTCPriceFeedAddress: tBTCMultiplicativePriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { tBTCPriceFeedAddress }) {

    const trace = deploymentManager.tracer();

    const tBTC = await deploymentManager.existing(
      'tBTC',
      TBTC_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const tBTCPriceFeed = await deploymentManager.existing(
      'tBTC:priceFeed',
      tBTCPriceFeedAddress,
      'mainnet'
    );

    newPriceFeedAddress = tBTCPriceFeedAddress;

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const tBTCAssetConfig = {
      asset: tBTC.address,
      priceFeed: tBTCPriceFeed.address,
      decimals: await tBTC.decimals(),
      borrowCollateralFactor: exp(0.76, 18),
      liquidateCollateralFactor: exp(0.81, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(285, 18),
    };

    const mainnetActions = [
      // 1. Add tBTC as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, tBTCAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add tBTC as collateral into cUSDTv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add tBTC into cUSDTv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDT market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/add-collateral-tbtc-to-eth-market-on-mainnet/5399/12).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/936) and [forum discussion](https://www.comp.xyz/t/add-collateral-tbtc-to-eth-market-on-mainnet/5399).\n\n\n## Proposal Actions\n\nThe first action adds tBTC asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';
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

    const tBTCAssetIndex = Number(await comet.numAssets()) - 1;

    const tBTC = await deploymentManager.existing(
      'tBTC',
      TBTC_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const tBTCAssetConfig = {
      asset: tBTC.address,
      priceFeed: newPriceFeedAddress,
      decimals: await tBTC.decimals(),
      borrowCollateralFactor: exp(0.76, 18),
      liquidateCollateralFactor: exp(0.81, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(285, 18),
    };

    // 1. Compare tBTC asset config with Comet and Configurator asset info
    const cometTBTCAssetInfo = await comet.getAssetInfoByAddress(TBTC_ADDRESS);
    expect(tBTCAssetIndex).to.be.equal(cometTBTCAssetInfo.offset);
    expect(tBTCAssetConfig.asset).to.be.equal(cometTBTCAssetInfo.asset);
    expect(tBTCAssetConfig.priceFeed).to.be.equal(cometTBTCAssetInfo.priceFeed);
    expect(exp(1, tBTCAssetConfig.decimals)).to.be.equal(cometTBTCAssetInfo.scale);
    expect(tBTCAssetConfig.borrowCollateralFactor).to.be.equal(cometTBTCAssetInfo.borrowCollateralFactor);
    expect(tBTCAssetConfig.liquidateCollateralFactor).to.be.equal(cometTBTCAssetInfo.liquidateCollateralFactor);
    expect(tBTCAssetConfig.liquidationFactor).to.be.equal(cometTBTCAssetInfo.liquidationFactor);
    expect(tBTCAssetConfig.supplyCap).to.be.equal(cometTBTCAssetInfo.supplyCap);

    const configuratorTBTCAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[tBTCAssetIndex];
    expect(tBTCAssetConfig.asset).to.be.equal(configuratorTBTCAssetConfig.asset);
    expect(tBTCAssetConfig.priceFeed).to.be.equal(configuratorTBTCAssetConfig.priceFeed);
    expect(tBTCAssetConfig.decimals).to.be.equal(configuratorTBTCAssetConfig.decimals);
    expect(tBTCAssetConfig.borrowCollateralFactor).to.be.equal(configuratorTBTCAssetConfig.borrowCollateralFactor);
    expect(tBTCAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorTBTCAssetConfig.liquidateCollateralFactor);
    expect(tBTCAssetConfig.liquidationFactor).to.be.equal(configuratorTBTCAssetConfig.liquidationFactor);
    expect(tBTCAssetConfig.supplyCap).to.be.equal(configuratorTBTCAssetConfig.supplyCap);
  },
});