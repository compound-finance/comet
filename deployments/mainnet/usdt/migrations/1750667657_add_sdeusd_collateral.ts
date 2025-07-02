import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const SDEUSD_ADDRESS = '0x5C5b196aBE0d54485975D1Ec29617D42D9198326';
const SDEUSD_TO_USD_PRICE_FEED = '0xE4829421ae79f2F44716cCbbb40751cd6Be3d483';

export default migration('1750667657_add_sdeusd_collateral', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();

    const sdeUSD = await deploymentManager.existing(
      'sdeUSD',
      SDEUSD_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );

    const sdeUSDPriceFeed = await deploymentManager.existing(
      'sdeUSD:priceFeed',
      SDEUSD_TO_USD_PRICE_FEED,
      'mainnet'
    );

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const sdeUSDAssetConfig = {
      asset: sdeUSD.address,
      priceFeed: sdeUSDPriceFeed.address,
      decimals: await sdeUSD.decimals(),
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.90, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(5_000_000, 18),
    };

    const mainnetActions = [
      // 1. Add sdeUSD as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, sdeUSDAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add sdeUSD as collateral into cUSDTv3 on Mainnet\n\n## Proposal summary\n\nWOOF! proposes to add sdeUSD into cUSDTv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDT market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/add-collateral-deusd-sdeusd-staked-on-usdc-usds-usdt-on-mainnet/6112/6).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/996) and [forum discussion](https://www.comp.xyz/t/add-collateral-deusd-sdeusd-staked-on-usdc-usds-usdt-on-mainnet/6112).\n\n\n## Proposal Actions\n\nThe first action adds sdeUSD asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';
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

    const sdeUSDAssetIndex = Number(await comet.numAssets()) - 1;

    const sdeUSD = await deploymentManager.existing(
      'sdeUSD',
      SDEUSD_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const deUSDAssetConfig = {
      asset: sdeUSD.address,
      priceFeed: SDEUSD_TO_USD_PRICE_FEED,
      decimals: 18n,
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.90, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(5_000_000, 18),
    };

    // 1. Compare sdeUSD asset config with Comet and Configurator asset info
    const cometSdeUSDAssetInfo = await comet.getAssetInfoByAddress(SDEUSD_ADDRESS);
    expect(sdeUSDAssetIndex).to.be.equal(cometSdeUSDAssetInfo.offset);
    expect(deUSDAssetConfig.asset).to.be.equal(cometSdeUSDAssetInfo.asset);
    expect(deUSDAssetConfig.priceFeed).to.be.equal(cometSdeUSDAssetInfo.priceFeed);
    expect(exp(1, deUSDAssetConfig.decimals)).to.be.equal(cometSdeUSDAssetInfo.scale);
    expect(deUSDAssetConfig.borrowCollateralFactor).to.be.equal(cometSdeUSDAssetInfo.borrowCollateralFactor);
    expect(deUSDAssetConfig.liquidateCollateralFactor).to.be.equal(cometSdeUSDAssetInfo.liquidateCollateralFactor);
    expect(deUSDAssetConfig.liquidationFactor).to.be.equal(cometSdeUSDAssetInfo.liquidationFactor);
    expect(deUSDAssetConfig.supplyCap).to.be.equal(cometSdeUSDAssetInfo.supplyCap);

    const configuratorSdeUSDAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[sdeUSDAssetIndex];
    expect(deUSDAssetConfig.asset).to.be.equal(configuratorSdeUSDAssetConfig.asset);
    expect(deUSDAssetConfig.priceFeed).to.be.equal(configuratorSdeUSDAssetConfig.priceFeed);
    expect(deUSDAssetConfig.decimals).to.be.equal(configuratorSdeUSDAssetConfig.decimals);
    expect(deUSDAssetConfig.borrowCollateralFactor).to.be.equal(configuratorSdeUSDAssetConfig.borrowCollateralFactor);
    expect(deUSDAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorSdeUSDAssetConfig.liquidateCollateralFactor);
    expect(deUSDAssetConfig.liquidationFactor).to.be.equal(configuratorSdeUSDAssetConfig.liquidationFactor);
    expect(deUSDAssetConfig.supplyCap).to.be.equal(configuratorSdeUSDAssetConfig.supplyCap);
  },
});
