import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const WUSDM_ADDRESS = '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812';
const WUSDM_TO_USDM_PRICE_FEED_ADDRESS = '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812';
const USDM_TO_USD_PRICE_FEED_ADDRESS = '0x079674468Fee6ab45aBfE986737A440701c49BdB';

let priceFeedAddress: string;

export default migration('1730374657_add_wusdm_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _wUSDMPriceFeed = await deploymentManager.deploy(
      'wUSDM:priceFeed',
      'pricefeeds/PriceFeedWith4626Support.sol',
      [
        WUSDM_TO_USDM_PRICE_FEED_ADDRESS, // wUSDM / USDM price feed
        USDM_TO_USD_PRICE_FEED_ADDRESS,   // USDM / USD price feed
        8,                                // decimals
        'wUSDM / USD price feed',         // description
      ],
      true
    );
    return { wUSDMPriceFeedAddress: _wUSDMPriceFeed.address };
  },

  enact: async (deploymentManager: DeploymentManager, _, { wUSDMPriceFeedAddress }) => {
    const trace = deploymentManager.tracer();

    const wUSDM = await deploymentManager.existing(
      'wUSDM',
      WUSDM_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const wUSDMPriceFeed = await deploymentManager.existing(
      'wUSDM:priceFeed',
      wUSDMPriceFeedAddress,
      'mainnet'
    );
    priceFeedAddress = wUSDMPriceFeed.address;
    const {
      governor,
      comet,
      cometAdmin,
      configurator
    } = await deploymentManager.getContracts();

    const newAssetConfig = {
      asset: wUSDM.address,
      priceFeed: wUSDMPriceFeed.address,
      decimals: await wUSDM.decimals(),
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.90, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(6_500_000, 18),
    };

    const mainnetActions = [
      // 1. Add wUSDM as asset
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

    const description = '# Add wUSDM as collateral into cUSDTv3 on Ethereum\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add wUSDM into cUSDTv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDT market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/list-wusdm-as-a-collateral-on-usdc-usdt-markets-on-arbitrum-and-ethereum/5590/3).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/930) and [forum discussion](https://www.comp.xyz/t/list-wusdm-as-a-collateral-on-usdc-usdt-markets-on-arbitrum-and-ethereum/5590).\n\n\n## Proposal Actions\n\nThe first proposal action adds wUSDM asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';
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

    const wUSDMAssetIndex = Number(await comet.numAssets()) - 1;

    const wUSDMAssetConfig = {
      asset: WUSDM_ADDRESS,
      priceFeed: priceFeedAddress,
      decimals: 18,
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.90, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(6_500_000, 18),
    };

    // 1. Compare proposed asset config with Comet asset info
    const wUSDMAssetInfo = await comet.getAssetInfoByAddress(WUSDM_ADDRESS);
    expect(wUSDMAssetIndex).to.be.equal(wUSDMAssetInfo.offset);
    expect(wUSDMAssetConfig.asset).to.be.equal(wUSDMAssetInfo.asset);
    expect(wUSDMAssetConfig.priceFeed).to.be.equal(wUSDMAssetInfo.priceFeed);
    expect(exp(1, wUSDMAssetConfig.decimals)).to.be.equal(wUSDMAssetInfo.scale);
    expect(wUSDMAssetConfig.borrowCollateralFactor).to.be.equal(wUSDMAssetInfo.borrowCollateralFactor);
    expect(wUSDMAssetConfig.liquidateCollateralFactor).to.be.equal(wUSDMAssetInfo.liquidateCollateralFactor);
    expect(wUSDMAssetConfig.liquidationFactor).to.be.equal(wUSDMAssetInfo.liquidationFactor);
    expect(wUSDMAssetConfig.supplyCap).to.be.equal(wUSDMAssetInfo.supplyCap);

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorWUSDMAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[wUSDMAssetIndex];
    expect(wUSDMAssetConfig.asset).to.be.equal(configuratorWUSDMAssetConfig.asset);
    expect(wUSDMAssetConfig.priceFeed).to.be.equal(configuratorWUSDMAssetConfig.priceFeed);
    expect(wUSDMAssetConfig.decimals).to.be.equal(configuratorWUSDMAssetConfig.decimals);
    expect(wUSDMAssetConfig.borrowCollateralFactor).to.be.equal(configuratorWUSDMAssetConfig.borrowCollateralFactor);
    expect(wUSDMAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorWUSDMAssetConfig.liquidateCollateralFactor);
    expect(wUSDMAssetConfig.liquidationFactor).to.be.equal(configuratorWUSDMAssetConfig.liquidationFactor);
    expect(wUSDMAssetConfig.supplyCap).to.be.equal(configuratorWUSDMAssetConfig.supplyCap);
  },
});
