import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const FBTC_ADDRESS = '0xC96dE26018A54D51c097160568752c4E3BD6C364';
const FBTC_TO_BTC_PRICE_FEED = '0xe5346a4Fd329768A99455d969724768a00CA63FB';
const BTC_TO_USD_PRICE_FEED = '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c';

let newPriceFeedAddress: string;

export default migration('1733936182_add_fbtc_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const FBTCMultiplicativePriceFeed = await deploymentManager.deploy(
      'FBTC:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        FBTC_TO_BTC_PRICE_FEED,  // FBTC / BTC price feed
        BTC_TO_USD_PRICE_FEED,   // BTC / USD price feed
        8,                       // decimals
        'FBTC / USD price feed'  // description
      ]
    );
    return { FBTCPriceFeedAddress: FBTCMultiplicativePriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { FBTCPriceFeedAddress }) {

    const trace = deploymentManager.tracer();

    const FBTC = await deploymentManager.existing(
      'FBTC',
      FBTC_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const FBTCPriceFeed = await deploymentManager.existing(
      'FBTC:priceFeed',
      FBTCPriceFeedAddress,
      'mainnet'
    );

    newPriceFeedAddress = FBTCPriceFeedAddress;

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const FBTCAssetConfig = {
      asset: FBTC.address,
      priceFeed: FBTCPriceFeed.address,
      decimals: await FBTC.decimals(),
      borrowCollateralFactor: exp(0.8, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(90, 8),
    };

    const mainnetActions = [
      // 1. Add FBTC as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, FBTCAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add FBTC as collateral into cUSDCv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add FBTC into cUSDCv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDC market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/add-collateral-fbtc-on-eth-usdt-usdc-markets-on-mainnet/5936/2).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/952) and [forum discussion](https://www.comp.xyz/t/add-collateral-fbtc-on-eth-usdt-usdc-markets-on-mainnet/5936).\n\n\n## Proposal Actions\n\nThe first action adds FBTC asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';
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

    const FBTCAssetIndex = Number(await comet.numAssets()) - 1;

    const FBTCAssetConfig = {
      asset: FBTC_ADDRESS,
      priceFeed: newPriceFeedAddress,
      decimals: 8,
      borrowCollateralFactor: exp(0.8, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(90, 8),
    };

    // 1. Compare FBTC asset config with Comet and Configurator asset info 
    const cometFBTCAssetInfo = await comet.getAssetInfoByAddress(FBTC_ADDRESS);
    expect(FBTCAssetIndex).to.be.equal(cometFBTCAssetInfo.offset);
    expect(FBTCAssetConfig.asset).to.be.equal(cometFBTCAssetInfo.asset);
    expect(FBTCAssetConfig.priceFeed).to.be.equal(cometFBTCAssetInfo.priceFeed);
    expect(exp(1, FBTCAssetConfig.decimals)).to.be.equal(cometFBTCAssetInfo.scale);
    expect(FBTCAssetConfig.borrowCollateralFactor).to.be.equal(cometFBTCAssetInfo.borrowCollateralFactor);
    expect(FBTCAssetConfig.liquidateCollateralFactor).to.be.equal(cometFBTCAssetInfo.liquidateCollateralFactor);
    expect(FBTCAssetConfig.liquidationFactor).to.be.equal(cometFBTCAssetInfo.liquidationFactor);
    expect(FBTCAssetConfig.supplyCap).to.be.equal(cometFBTCAssetInfo.supplyCap);

    const configuratorFBTCAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[FBTCAssetIndex];
    expect(FBTCAssetConfig.asset).to.be.equal(configuratorFBTCAssetConfig.asset);
    expect(FBTCAssetConfig.priceFeed).to.be.equal(configuratorFBTCAssetConfig.priceFeed);
    expect(FBTCAssetConfig.decimals).to.be.equal(configuratorFBTCAssetConfig.decimals);
    expect(FBTCAssetConfig.borrowCollateralFactor).to.be.equal(configuratorFBTCAssetConfig.borrowCollateralFactor);
    expect(FBTCAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorFBTCAssetConfig.liquidateCollateralFactor);
    expect(FBTCAssetConfig.liquidationFactor).to.be.equal(configuratorFBTCAssetConfig.liquidationFactor);
    expect(FBTCAssetConfig.supplyCap).to.be.equal(configuratorFBTCAssetConfig.supplyCap);
  },
});
