import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const SUSDS_ADDRESS = '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD';

let newPriceFeedAddress: string;

export default migration('1731419158_add_susds_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const usdsPricefeed = await deploymentManager.fromDep('USDS:priceFeed', 'mainnet', 'usds');
    const sUSDSPriceFeed = await deploymentManager.deploy(
      'sUSDS:priceFeed',
      'pricefeeds/PriceFeedWith4626Support.sol',
      [
        SUSDS_ADDRESS,            // sUSDS / USD price feed
        usdsPricefeed.address,    // USDS / USD price feed
        8,                        // decimals
        'sUSDS / USD price feed', // description
      ],
      true
    );
    return { sUSDSPriceFeedAddress: sUSDSPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { sUSDSPriceFeedAddress }) {

    const trace = deploymentManager.tracer();

    const sUSDS = await deploymentManager.existing(
      'sUSDS',
      SUSDS_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const sUSDSPriceFeed = await deploymentManager.existing(
      'sUSDS:priceFeed',
      sUSDSPriceFeedAddress,
      'mainnet'
    );

    newPriceFeedAddress = sUSDSPriceFeedAddress;

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const sUSDSAssetConfig = {
      asset: sUSDS.address,
      priceFeed: sUSDSPriceFeed.address,
      decimals: await sUSDS.decimals(),
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.92, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(50_000_000 , 18),
    };

    const mainnetActions = [
      // 1. Add sUSDS as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, sUSDSAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add sUSDS as collateral into cUSDSv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add sUSDS into cUSDSv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDS market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/add-collateral-usds-market-on-eth-mainnet/5781/5).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/947) and [forum discussion](https://www.comp.xyz/t/add-collateral-usds-market-on-eth-mainnet/5781).\n\n\n## Proposal Actions\n\nThe first action adds sUSDS asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';
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

    const sUSDSAssetIndex = Number(await comet.numAssets()) - 1;

    const sUSDS = await deploymentManager.existing(
      'sUSDS',
      SUSDS_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const sUSDSAssetConfig = {
      asset: sUSDS.address,
      priceFeed: newPriceFeedAddress,
      decimals: await sUSDS.decimals(),
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.92, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(50_000_000 , 18),
    };

    // 1. Compare sUSDS asset config with Comet and Configurator asset info
    const cometSUSDSAssetInfo = await comet.getAssetInfoByAddress(SUSDS_ADDRESS);
    expect(sUSDSAssetIndex).to.be.equal(cometSUSDSAssetInfo.offset);
    expect(sUSDSAssetConfig.asset).to.be.equal(cometSUSDSAssetInfo.asset);
    expect(sUSDSAssetConfig.priceFeed).to.be.equal(cometSUSDSAssetInfo.priceFeed);
    expect(exp(1, sUSDSAssetConfig.decimals)).to.be.equal(cometSUSDSAssetInfo.scale);
    expect(sUSDSAssetConfig.borrowCollateralFactor).to.be.equal(cometSUSDSAssetInfo.borrowCollateralFactor);
    expect(sUSDSAssetConfig.liquidateCollateralFactor).to.be.equal(cometSUSDSAssetInfo.liquidateCollateralFactor);
    expect(sUSDSAssetConfig.liquidationFactor).to.be.equal(cometSUSDSAssetInfo.liquidationFactor);
    expect(sUSDSAssetConfig.supplyCap).to.be.equal(cometSUSDSAssetInfo.supplyCap);

    const configuratorSUSDSAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[sUSDSAssetIndex];
    expect(sUSDSAssetConfig.asset).to.be.equal(configuratorSUSDSAssetConfig.asset);
    expect(sUSDSAssetConfig.priceFeed).to.be.equal(configuratorSUSDSAssetConfig.priceFeed);
    expect(sUSDSAssetConfig.decimals).to.be.equal(configuratorSUSDSAssetConfig.decimals);
    expect(sUSDSAssetConfig.borrowCollateralFactor).to.be.equal(configuratorSUSDSAssetConfig.borrowCollateralFactor);
    expect(sUSDSAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorSUSDSAssetConfig.liquidateCollateralFactor);
    expect(sUSDSAssetConfig.liquidationFactor).to.be.equal(configuratorSUSDSAssetConfig.liquidationFactor);
    expect(sUSDSAssetConfig.supplyCap).to.be.equal(configuratorSUSDSAssetConfig.supplyCap);
  },
});