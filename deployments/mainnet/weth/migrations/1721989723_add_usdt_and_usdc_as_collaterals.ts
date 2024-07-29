import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USDT_PRICE_FEED_ADDRESS = '0xEe9F2375b4bdF6387aa8265dD4FB8F16512A1d46';

const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDC_PRICE_FEED_ADDRESS = '0x986b5E1e1755e3C2440e960477f25201B0a8bbD4';

const NEW_FACTORY_ADDRESS = '0x89128FE4Fc91038C13220E74991F9557F816c865';

export default migration('1721989723_add_usdt_and_usdc_as_collaterals', {
  async prepare(deploymentManager: DeploymentManager) {
    const _usdtScalingPriceFeed = await deploymentManager.deploy(
      'USDT:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        USDT_PRICE_FEED_ADDRESS,  // USDT / ETH price feed
        8                         // decimals
      ]
    );

    const _usdcScalingPriceFeed = await deploymentManager.deploy(
      'USDC:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        USDC_PRICE_FEED_ADDRESS,  // USDC / ETH price feed
        8                         // decimals
      ]
    );
    return { usdtScalingPriceFeed: _usdtScalingPriceFeed.address, usdcScalingPriceFeed: _usdcScalingPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { usdtScalingPriceFeed, usdcScalingPriceFeed }) {

    const trace = deploymentManager.tracer();

    const USDT = await deploymentManager.existing(
      'USDT',
      USDT_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const usdtPricefeed = await deploymentManager.existing(
      'USDT:priceFeed',
      usdtScalingPriceFeed,
      'mainnet'
    );

    const USDC = await deploymentManager.existing(
      'USDC',
      USDC_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const usdcPricefeed = await deploymentManager.existing(
      'USDC:priceFeed',
      usdcScalingPriceFeed,
      'mainnet'
    );

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const usdtAssetConfig = {
      asset: USDT.address,
      priceFeed: usdtPricefeed.address,
      decimals: await USDT.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(50_000_000, 6),
    };

    const usdcAssetConfig = {
      asset: USDC.address,
      priceFeed: usdcPricefeed.address,
      decimals: 6,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(50_000_000, 6),
    };

    const mainnetActions = [
      // 1. Set new factory
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [comet.address, NEW_FACTORY_ADDRESS],
      },
      // 2. Add USDT as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, usdtAssetConfig],
      },
      // 3. Add USDC as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, usdcAssetConfig],
      },
      // 4. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add USDT and USDC as collaterals into cWETHv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add USDT and USDC into cWETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/add-dai-usdc-and-usdt-as-collaterals-to-weth-comets-on-mainnet-and-arbitrum/5415/2).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/893) and [forum discussion](https://www.comp.xyz/t/add-dai-usdc-and-usdt-as-collaterals-to-weth-comets-on-mainnet-and-arbitrum/5415).\n\n\n## Proposal Actions\n\nThe first proposal action sets new factory that supports USDT non-standard interface.\n\nThe second proposal action adds USDT asset as collateral with corresponding configurations.\n\nThe third proposal action adds USDC asset as collateral with corresponding configurations.\n\nThe fourth action deploys and upgrades Comet to a new version.';
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
    // second proposal 
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const usdtAssetIndex = Number(await comet.numAssets()) - 2;
    const usdcAssetIndex = Number(await comet.numAssets()) - 1;

    const USDT = await deploymentManager.existing(
      'USDT',
      USDT_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const usdtAssetConfig = {
      asset: USDT.address,
      priceFeed: '',
      decimals: await USDT.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(50_000_000, 6),
    };

    const USDC = await deploymentManager.existing(
      'USDC',
      USDC_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const usdcAssetConfig = {
      asset: USDC.address,
      priceFeed: '',
      decimals: 6,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(50_000_000, 6),
    };

    // 1. Compare USDT asset config with Comet and Configurator asset info
    const cometUsdtAssetInfo = await comet.getAssetInfo(usdtAssetIndex);
    expect(usdtAssetIndex).to.be.equal(cometUsdtAssetInfo.offset);
    expect(usdtAssetConfig.asset).to.be.equal(cometUsdtAssetInfo.asset);
    expect(exp(1, usdtAssetConfig.decimals)).to.be.equal(cometUsdtAssetInfo.scale);
    expect(usdtAssetConfig.borrowCollateralFactor).to.be.equal(cometUsdtAssetInfo.borrowCollateralFactor);
    expect(usdtAssetConfig.liquidateCollateralFactor).to.be.equal(cometUsdtAssetInfo.liquidateCollateralFactor);
    expect(usdtAssetConfig.liquidationFactor).to.be.equal(cometUsdtAssetInfo.liquidationFactor);
    expect(usdtAssetConfig.supplyCap).to.be.equal(cometUsdtAssetInfo.supplyCap);

    const configuratorUsdtAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[usdtAssetIndex];
    expect(usdtAssetConfig.asset).to.be.equal(configuratorUsdtAssetConfig.asset);
    expect(usdtAssetConfig.decimals).to.be.equal(configuratorUsdtAssetConfig.decimals);
    expect(usdtAssetConfig.borrowCollateralFactor).to.be.equal(configuratorUsdtAssetConfig.borrowCollateralFactor);
    expect(usdtAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorUsdtAssetConfig.liquidateCollateralFactor);
    expect(usdtAssetConfig.liquidationFactor).to.be.equal(configuratorUsdtAssetConfig.liquidationFactor);
    expect(usdtAssetConfig.supplyCap).to.be.equal(configuratorUsdtAssetConfig.supplyCap);

    // 2. Compare USDC asset config with Comet and Configurator asset info
    const cometUsdcAssetInfo = await comet.getAssetInfo(usdcAssetIndex);
    expect(usdcAssetIndex).to.be.equal(cometUsdcAssetInfo.offset);
    expect(usdcAssetConfig.asset).to.be.equal(cometUsdcAssetInfo.asset);
    expect(exp(1, usdcAssetConfig.decimals)).to.be.equal(cometUsdcAssetInfo.scale);
    expect(usdcAssetConfig.borrowCollateralFactor).to.be.equal(cometUsdcAssetInfo.borrowCollateralFactor);
    expect(usdcAssetConfig.liquidateCollateralFactor).to.be.equal(cometUsdcAssetInfo.liquidateCollateralFactor);
    expect(usdcAssetConfig.liquidationFactor).to.be.equal(cometUsdcAssetInfo.liquidationFactor);
    expect(usdcAssetConfig.supplyCap).to.be.equal(cometUsdcAssetInfo.supplyCap);

    const configuratorUsdcAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[usdcAssetIndex];
    expect(usdcAssetConfig.asset).to.be.equal(configuratorUsdcAssetConfig.asset);
    expect(usdcAssetConfig.decimals).to.be.equal(configuratorUsdcAssetConfig.decimals);
    expect(usdcAssetConfig.borrowCollateralFactor).to.be.equal(configuratorUsdcAssetConfig.borrowCollateralFactor);
    expect(usdcAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorUsdcAssetConfig.liquidateCollateralFactor);
    expect(usdcAssetConfig.liquidationFactor).to.be.equal(configuratorUsdcAssetConfig.liquidationFactor);
    expect(usdcAssetConfig.supplyCap).to.be.equal(configuratorUsdcAssetConfig.supplyCap);
  },
});
