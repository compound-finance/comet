import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const OSETH_ADDRESS = '0xf1C9acDc66974dFB6dEcB12aA385b9cD01190E38';
const OSETH_PRICE_FEED_ADDRESS = '0x8023518b2192FB5384DAdc596765B3dD1cdFe471';

export default migration('1718974114_add_oseth_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _osETHScalingPriceFeed = await deploymentManager.deploy(
      'osETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        OSETH_PRICE_FEED_ADDRESS, // osETH / ETH price feed
        8                         // decimals
      ]
    );
    return { osETHScalingPriceFeed: _osETHScalingPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { osETHScalingPriceFeed }) {

    const trace = deploymentManager.tracer();

    const osETH = await deploymentManager.existing(
      'osETH',
      OSETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const osEthPricefeed = await deploymentManager.existing(
      'osETH:priceFeed',
      osETHScalingPriceFeed,
      'mainnet'
    );

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const osETHAssetConfig = {
      asset: osETH.address,
      priceFeed: osEthPricefeed.address,
      decimals: await osETH.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(10_000, 18),
    };

    const mainnetActions = [
      // 1. Add osETH as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, osETHAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add osETH as collateral into cWETHv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add osETH into cWETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet osETH](https://www.comp.xyz/t/add-oseth-as-a-collateral-on-ethereum-mainnet/5272/2).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/871) and [forum discussion osETH](https://www.comp.xyz/t/add-oseth-as-a-collateral-on-ethereum-mainnet/5272).\n\n## Price feed\n\nChainlink does not have osETH/ETH price feed on their website, however, Chainlink team ensured us that this address is the native exchange rate [price feed](https://etherscan.io/address/0x8023518b2192FB5384DAdc596765B3dD1cdFe471)\n\n\n## Proposal Actions\n\nThe first action adds osETH asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';
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

    const osETHAssetIndex = Number(await comet.numAssets()) - 1;

    const osETH = await deploymentManager.existing(
      'osETH',
      OSETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const osETHAssetConfig = {
      asset: osETH.address,
      priceFeed: '',
      decimals: await osETH.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(10_000, 18), // 10_000
    };

    // 1. Compare osETH asset config with Comet and Configurator asset info
    const cometOsETHAssetInfo = await comet.getAssetInfoByAddress(
      OSETH_ADDRESS
    );
    expect(osETHAssetIndex).to.be.equal(cometOsETHAssetInfo.offset);
    expect(osETHAssetConfig.asset).to.be.equal(cometOsETHAssetInfo.asset);
    expect(exp(1, osETHAssetConfig.decimals)).to.be.equal(
      cometOsETHAssetInfo.scale
    );
    expect(osETHAssetConfig.borrowCollateralFactor).to.be.equal(
      cometOsETHAssetInfo.borrowCollateralFactor
    );
    expect(osETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      cometOsETHAssetInfo.liquidateCollateralFactor
    );
    expect(osETHAssetConfig.liquidationFactor).to.be.equal(
      cometOsETHAssetInfo.liquidationFactor
    );
    expect(osETHAssetConfig.supplyCap).to.be.equal(
      cometOsETHAssetInfo.supplyCap
    );

    const configuratorOsETHAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[osETHAssetIndex];
    expect(osETHAssetConfig.asset).to.be.equal(
      configuratorOsETHAssetConfig.asset
    );
    expect(osETHAssetConfig.decimals).to.be.equal(
      configuratorOsETHAssetConfig.decimals
    );
    expect(osETHAssetConfig.borrowCollateralFactor).to.be.equal(
      configuratorOsETHAssetConfig.borrowCollateralFactor
    );
    expect(osETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      configuratorOsETHAssetConfig.liquidateCollateralFactor
    );
    expect(osETHAssetConfig.liquidationFactor).to.be.equal(
      configuratorOsETHAssetConfig.liquidationFactor
    );
    expect(osETHAssetConfig.supplyCap).to.be.equal(
      configuratorOsETHAssetConfig.supplyCap
    );
  },
});
