import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const SFRAX_ADDRESS = '0xA663B02CF0a4b149d2aD41910CB81e23e1c41c32';
const SFRAX_TO_FRAX_PRICE_FEED_ADDRESS = '0xA663B02CF0a4b149d2aD41910CB81e23e1c41c32';
const FRAX_TO_USD_PRICE_FEED_ADDRESS = '0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD';

let priceFeedAddress: string;

export default migration('1730371308_add_sfrax_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _sFRAXPriceFeed = await deploymentManager.deploy(
      'sFRAX:priceFeed',
      'pricefeeds/PriceFeedWith4626Support.sol',
      [
        SFRAX_TO_FRAX_PRICE_FEED_ADDRESS, // sFRAX / FRAX price feed
        FRAX_TO_USD_PRICE_FEED_ADDRESS,   // FRAX / USD price feed
        8,                                // decimals
        'sFRAX / USD price feed',         // description
      ],
      true
    );
    return { sFRAXPriceFeedAddress: _sFRAXPriceFeed.address };
  },

  enact: async (deploymentManager: DeploymentManager, _, { sFRAXPriceFeedAddress }) => {
    const trace = deploymentManager.tracer();

    const sFRAX = await deploymentManager.existing(
      'sFRAX',
      SFRAX_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const sFRAXPriceFeed = await deploymentManager.existing(
      'sFRAX:priceFeed',
      sFRAXPriceFeedAddress,
      'mainnet'
    );
    priceFeedAddress = sFRAXPriceFeed.address;
    const {
      governor,
      comet,
      cometAdmin,
      configurator
    } = await deploymentManager.getContracts();

    const newAssetConfig = {
      asset: sFRAX.address,
      priceFeed: sFRAXPriceFeed.address,
      decimals: await sFRAX.decimals(),
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.90, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(10_000_000, 18),
    };

    const mainnetActions = [
      // 1. Add sFRAX as asset
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

    const description = '# Add sFRAX as collateral into cUSDTv3 on Ethereum\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add sFRAX into cUSDTv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDT market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-sfrax-as-collateral-to-usdt-markets-on-ethereum-mainnet/5615/3).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/932) and [forum discussion](https://www.comp.xyz/t/add-sfrax-as-collateral-to-usdt-markets-on-ethereum-mainnet/5615).\n\n\n## Proposal Actions\n\nThe first proposal action adds sFRAX asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';
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

    const sFRAXAssetIndex = Number(await comet.numAssets()) - 1;

    const sFRAXAssetConfig = {
      asset: SFRAX_ADDRESS,
      priceFeed: priceFeedAddress,
      decimals: 18,
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.90, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(10_000_000, 18),
    };

    // 1. Compare proposed asset config with Comet asset info
    const sFRAXAssetInfo = await comet.getAssetInfoByAddress(SFRAX_ADDRESS);
    expect(sFRAXAssetIndex).to.be.equal(sFRAXAssetInfo.offset);
    expect(sFRAXAssetConfig.asset).to.be.equal(sFRAXAssetInfo.asset);
    expect(sFRAXAssetConfig.priceFeed).to.be.equal(sFRAXAssetInfo.priceFeed);
    expect(exp(1, sFRAXAssetConfig.decimals)).to.be.equal(sFRAXAssetInfo.scale);
    expect(sFRAXAssetConfig.borrowCollateralFactor).to.be.equal(sFRAXAssetInfo.borrowCollateralFactor);
    expect(sFRAXAssetConfig.liquidateCollateralFactor).to.be.equal(sFRAXAssetInfo.liquidateCollateralFactor);
    expect(sFRAXAssetConfig.liquidationFactor).to.be.equal(sFRAXAssetInfo.liquidationFactor);
    expect(sFRAXAssetConfig.supplyCap).to.be.equal(sFRAXAssetInfo.supplyCap);

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorSFRAXAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[sFRAXAssetIndex];
    expect(sFRAXAssetConfig.asset).to.be.equal(configuratorSFRAXAssetConfig.asset);
    expect(sFRAXAssetConfig.priceFeed).to.be.equal(configuratorSFRAXAssetConfig.priceFeed);
    expect(sFRAXAssetConfig.decimals).to.be.equal(configuratorSFRAXAssetConfig.decimals);
    expect(sFRAXAssetConfig.borrowCollateralFactor).to.be.equal(configuratorSFRAXAssetConfig.borrowCollateralFactor);
    expect(sFRAXAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorSFRAXAssetConfig.liquidateCollateralFactor);
    expect(sFRAXAssetConfig.liquidationFactor).to.be.equal(configuratorSFRAXAssetConfig.liquidationFactor);
    expect(sFRAXAssetConfig.supplyCap).to.be.equal(configuratorSFRAXAssetConfig.supplyCap);
  },
});