import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';


const SKY_ADDRESS = '0x56072C95FAA701256059aa122697B133aDEd9279';
const SKY_USD_PRICE_FEED_ADDRESS = '0xee10fE5E7aa92dd7b136597449c3d5813cFC5F18';

export default migration('1739941370_add_sky_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    return {};
  },

  async enact(deploymentManager: DeploymentManager, _) {
    const trace = deploymentManager.tracer();

    const SKY = await deploymentManager.existing(
      'SKY',
      SKY_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );

    const skyPricefeed = await deploymentManager.existing(
      'SKY:priceFeed',
      SKY_USD_PRICE_FEED_ADDRESS,
      'mainnet'
    );

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const skyAssetConfig = {
      asset: SKY.address,
      priceFeed: skyPricefeed.address,
      decimals: await SKY.decimals(),
      borrowCollateralFactor: exp(0.73, 18),
      liquidateCollateralFactor: exp(0.79, 18),
      liquidationFactor: exp(0.85, 18),
      supplyCap: exp(144_000_000, 18), 
    };

    const mainnetActions = [
      // 1. Add SKY as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, skyAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add SKY as collateral into cUSDCv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add SKY into cUSDCv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDC market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/add-sky-as-collateral-on-usds-usdc-usdt-markets-on-eth-mainnet/6074).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/966) and [forum discussion](https://www.comp.xyz/t/add-sky-as-collateral-on-usds-usdc-usdt-markets-on-eth-mainnet/6074).\n\n\n## Proposal Actions\n\nThe first action adds SKY asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';

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

    const skyAssetIndex = Number(await comet.numAssets()) - 1;

    const SKY = await deploymentManager.existing(
      'SKY',
      SKY_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );

    const skyAssetConfig = {
      asset: SKY.address,
      priceFeed: '',
      decimals: await SKY.decimals(),
      borrowCollateralFactor: exp(0.73, 18),
      liquidateCollateralFactor: exp(0.79, 18),
      liquidationFactor: exp(0.85, 18),
      supplyCap: exp(144_000_000, 18), 
    };

    // 1. & 2. Compare SKY asset config with Comet and Configurator asset info
    const cometSKYHAssetInfo = await comet.getAssetInfoByAddress(
      SKY_ADDRESS
    );

    expect(skyAssetIndex).to.be.equal(cometSKYHAssetInfo.offset);
    expect(skyAssetConfig.asset).to.be.equal(cometSKYHAssetInfo.asset);
    expect(exp(1, skyAssetConfig.decimals)).to.be.equal(
      cometSKYHAssetInfo.scale
    );
    expect(skyAssetConfig.borrowCollateralFactor).to.be.equal(
      cometSKYHAssetInfo.borrowCollateralFactor
    );
    expect(skyAssetConfig.liquidateCollateralFactor).to.be.equal(
      cometSKYHAssetInfo.liquidateCollateralFactor
    );
    expect(skyAssetConfig.liquidationFactor).to.be.equal(
      cometSKYHAssetInfo.liquidationFactor
    );
    expect(skyAssetConfig.supplyCap).to.be.equal(
      cometSKYHAssetInfo.supplyCap
    );
    const configuratorEsETHAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[skyAssetIndex];
    expect(skyAssetConfig.asset).to.be.equal(
      configuratorEsETHAssetConfig.asset
    );
    expect(skyAssetConfig.decimals).to.be.equal(
      configuratorEsETHAssetConfig.decimals
    );
    expect(skyAssetConfig.borrowCollateralFactor).to.be.equal(
      configuratorEsETHAssetConfig.borrowCollateralFactor
    );
    expect(skyAssetConfig.liquidateCollateralFactor).to.be.equal(
      configuratorEsETHAssetConfig.liquidateCollateralFactor
    );
    expect(skyAssetConfig.liquidationFactor).to.be.equal(
      configuratorEsETHAssetConfig.liquidationFactor
    );
    expect(skyAssetConfig.supplyCap).to.be.equal(
      configuratorEsETHAssetConfig.supplyCap
    );
  },
});