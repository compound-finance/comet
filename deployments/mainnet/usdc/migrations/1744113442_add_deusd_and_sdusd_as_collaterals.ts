import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const DEUSD_ADDRESS = '0x15700B564Ca08D9439C58cA5053166E8317aa138';
const SDEUSD_ADDRESS = '0x5C5b196aBE0d54485975D1Ec29617D42D9198326';
const DEUSD_TO_USD_PRICE_FEED = '0x471a6299C027Bd81ed4D66069dc510Bd0569f4F8';

let newPriceFeedAddress: string;

export default migration('1744113442_add_deusd_and_sdusd_as_collaterals', {
  async prepare(deploymentManager: DeploymentManager) {
    const sdeUSDMultiplicativePriceFeed = await deploymentManager.deploy(
      'sdeUSD:priceFeed',
      'pricefeeds/PriceFeedWith4626Support.sol',
      [
        SDEUSD_ADDRESS,            // sdeUSD / deUSD price feed
        DEUSD_TO_USD_PRICE_FEED,   // deUSD / USD price feed
        8,                         // decimals
        'sdeUSD / USD price feed', // description
      ],
      true
    );
    return { sdeUSDPriceFeedAddress: sdeUSDMultiplicativePriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { sdeUSDPriceFeedAddress }) {

    const trace = deploymentManager.tracer();

    const deUSD = await deploymentManager.existing(
      'deUSD',
      DEUSD_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const deUSDPriceFeed = await deploymentManager.existing(
      'deUSD:priceFeed',
      DEUSD_TO_USD_PRICE_FEED,
      'mainnet'
    );

    const sdeUSD = await deploymentManager.existing(
      'sdeUSD',
      SDEUSD_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const sdeUSDPriceFeed = await deploymentManager.existing(
      'sdeUSD:priceFeed',
      sdeUSDPriceFeedAddress,
      'mainnet'
    );

    newPriceFeedAddress = sdeUSDPriceFeedAddress;

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const deUSDAssetConfig = {
      asset: deUSD.address,
      priceFeed: deUSDPriceFeed.address,
      decimals: await deUSD.decimals(),
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.9, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(8_000_000, 18)
    };

    const sdeUSDAssetConfig = {
      asset: sdeUSD.address,
      priceFeed: sdeUSDPriceFeed.address,
      decimals: await sdeUSD.decimals(),
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.9, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(5_000_000, 18)
    };

    const mainnetActions = [
      // 1. Add deUSD as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, deUSDAssetConfig],
      },
      // 2. Add sdeUSD as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, sdeUSDAssetConfig],
      },
      // 3. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add deUSD and sdeUSD as collateral into cUSDCv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add sdeUSD and deUSD into cUSDCv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDC market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/add-collateral-deusd-sdeusd-staked-on-usdc-usds-usdt-on-mainnet/6112/6).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/<>) and [forum discussion](https://www.comp.xyz/t/add-collateral-deusd-sdeusd-staked-on-usdc-usds-usdt-on-mainnet/6112).\n\n\n## Proposal Actions\n\nThe first action adds deUSD asset as collateral with corresponding configurations.\n\nThe second action adds sdeUSD asset as collateral with corresponding configurations.\n\nThe third action deploys and upgrades Comet to a new version.';
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

    const deUSDAssetIndex = Number(await comet.numAssets()) - 2;
    const sdeUSDAssetIndex = Number(await comet.numAssets()) - 1;

    const deUSD = await deploymentManager.existing(
      'deUSD',
      DEUSD_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const deUSDAssetConfig = {
      asset: deUSD.address,
      priceFeed: DEUSD_TO_USD_PRICE_FEED,
      decimals: await deUSD.decimals(),
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.9, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(8_000_000, 18),
    };

    const sdeUSD = await deploymentManager.existing(
      'sdeUSD',
      SDEUSD_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const sdeUSDAssetConfig = {
      asset: sdeUSD.address,
      priceFeed: newPriceFeedAddress,
      decimals: await sdeUSD.decimals(),
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.9, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(5_000_000, 18),
    };

    // 1. Compare deUSD asset config with Comet and Configurator asset info
    const cometDeUSDAssetInfo = await comet.getAssetInfoByAddress(DEUSD_ADDRESS);
    expect(deUSDAssetIndex).to.be.equal(cometDeUSDAssetInfo.offset);
    expect(deUSDAssetConfig.asset).to.be.equal(cometDeUSDAssetInfo.asset);
    expect(deUSDAssetConfig.priceFeed).to.be.equal(cometDeUSDAssetInfo.priceFeed);
    expect(exp(1, deUSDAssetConfig.decimals)).to.be.equal(cometDeUSDAssetInfo.scale);
    expect(deUSDAssetConfig.borrowCollateralFactor).to.be.equal(cometDeUSDAssetInfo.borrowCollateralFactor);
    expect(deUSDAssetConfig.liquidateCollateralFactor).to.be.equal(cometDeUSDAssetInfo.liquidateCollateralFactor);
    expect(deUSDAssetConfig.liquidationFactor).to.be.equal(cometDeUSDAssetInfo.liquidationFactor);
    expect(deUSDAssetConfig.supplyCap).to.be.equal(cometDeUSDAssetInfo.supplyCap);

    const configuratorDeUSDAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[deUSDAssetIndex];
    expect(deUSDAssetConfig.asset).to.be.equal(configuratorDeUSDAssetConfig.asset);
    expect(deUSDAssetConfig.priceFeed).to.be.equal(configuratorDeUSDAssetConfig.priceFeed);
    expect(deUSDAssetConfig.decimals).to.be.equal(configuratorDeUSDAssetConfig.decimals);
    expect(deUSDAssetConfig.borrowCollateralFactor).to.be.equal(configuratorDeUSDAssetConfig.borrowCollateralFactor);
    expect(deUSDAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorDeUSDAssetConfig.liquidateCollateralFactor);
    expect(deUSDAssetConfig.liquidationFactor).to.be.equal(configuratorDeUSDAssetConfig.liquidationFactor);
    expect(deUSDAssetConfig.supplyCap).to.be.equal(configuratorDeUSDAssetConfig.supplyCap);

    // 2. Compare sdeUSD asset config with Comet and Configurator asset info
    const cometSdeUSDAssetInfo = await comet.getAssetInfoByAddress(SDEUSD_ADDRESS);
    expect(sdeUSDAssetIndex).to.be.equal(cometSdeUSDAssetInfo.offset);
    expect(sdeUSDAssetConfig.asset).to.be.equal(cometSdeUSDAssetInfo.asset);
    expect(sdeUSDAssetConfig.priceFeed).to.be.equal(cometSdeUSDAssetInfo.priceFeed);
    expect(exp(1, sdeUSDAssetConfig.decimals)).to.be.equal(cometSdeUSDAssetInfo.scale);
    expect(sdeUSDAssetConfig.borrowCollateralFactor).to.be.equal(cometSdeUSDAssetInfo.borrowCollateralFactor);
    expect(sdeUSDAssetConfig.liquidateCollateralFactor).to.be.equal(cometSdeUSDAssetInfo.liquidateCollateralFactor);
    expect(sdeUSDAssetConfig.liquidationFactor).to.be.equal(cometSdeUSDAssetInfo.liquidationFactor);
    expect(sdeUSDAssetConfig.supplyCap).to.be.equal(cometSdeUSDAssetInfo.supplyCap);

    const configuratorSdeUSDAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[sdeUSDAssetIndex];
    expect(sdeUSDAssetConfig.asset).to.be.equal(configuratorSdeUSDAssetConfig.asset);
    expect(sdeUSDAssetConfig.priceFeed).to.be.equal(configuratorSdeUSDAssetConfig.priceFeed);
    expect(sdeUSDAssetConfig.decimals).to.be.equal(configuratorSdeUSDAssetConfig.decimals);
    expect(sdeUSDAssetConfig.borrowCollateralFactor).to.be.equal(configuratorSdeUSDAssetConfig.borrowCollateralFactor);
    expect(sdeUSDAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorSdeUSDAssetConfig.liquidateCollateralFactor);
    expect(sdeUSDAssetConfig.liquidationFactor).to.be.equal(configuratorSdeUSDAssetConfig.liquidationFactor);
    expect(sdeUSDAssetConfig.supplyCap).to.be.equal(configuratorSdeUSDAssetConfig.supplyCap);
  },
});