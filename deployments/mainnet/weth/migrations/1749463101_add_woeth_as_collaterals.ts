import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const WOETH_ADDRESS = '0xDcEe70654261AF21C44c093C300eD3Bb97b78192';

export default migration('1749463101_add_woeth_as_collaterals', {
  async prepare(deploymentManager: DeploymentManager) {
    const wethPricefeed = await deploymentManager.fromDep('WETH:priceFeed', 'mainnet', 'weth');
    const wOETHPriceFeed = await deploymentManager.deploy(
      'wOETH:priceFeed',
      'pricefeeds/PriceFeedWith4626Support.sol',
      [
        WOETH_ADDRESS,            // wOETH / OETH price feed
        wethPricefeed.address,    // oETH / ETH price feed (1:1)
        8,                        // decimals
        'sUSDS / USD price feed', // description
      ],
      true
    );
    return { wOETHPriceFeedAddress: wOETHPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { wOETHPriceFeedAddress }) {

    const trace = deploymentManager.tracer();

    const wOETH = await deploymentManager.existing(
      'wOETH',
      WOETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const wOETHPricefeed = await deploymentManager.existing(
      'wOETH:priceFeed',
      wOETHPriceFeedAddress,
      'mainnet'
    );

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const wOETHAssetConfig = {
      asset: wOETH.address,
      priceFeed: wOETHPricefeed.address,
      decimals: await wOETH.decimals(),
      borrowCollateralFactor: exp(0.85, 18),
      liquidateCollateralFactor: exp(0.90, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(2_100, 18),
    };

    const mainnetActions = [
      // 1. Add wOETH as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, wOETHAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add wOETH as collaterals into cWETHv3 on Mainnet\n\n## Proposal summary\n\nWOOF! proposes to add wOETH into cWETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/add-woeth-market-on-ethereum/5351/4).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/988) and [forum discussion](https://www.comp.xyz/t/add-woeth-market-on-ethereum/5351).\n\n\n## Proposal Actions\n\nThe first proposal action adds wOETH asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';
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

    const wOETHAssetIndex = Number(await comet.numAssets()) - 1;

    const wOETH = await deploymentManager.existing(
      'wOETH',
      WOETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const wOETHAssetConfig = {
      asset: wOETH.address,
      priceFeed: '',
      decimals: await wOETH.decimals(),
      borrowCollateralFactor: exp(0.85, 18),
      liquidateCollateralFactor: exp(0.90, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(2_100, 18),
    };

    // 1. Compare wOETH asset config with Comet and Configurator asset info
    const cometWOETHAssetInfo = await comet.getAssetInfo(wOETHAssetIndex);
    expect(wOETHAssetIndex).to.be.equal(cometWOETHAssetInfo.offset);
    expect(wOETHAssetConfig.asset).to.be.equal(cometWOETHAssetInfo.asset);
    expect(exp(1, wOETHAssetConfig.decimals)).to.be.equal(cometWOETHAssetInfo.scale);
    expect(wOETHAssetConfig.borrowCollateralFactor).to.be.equal(cometWOETHAssetInfo.borrowCollateralFactor);
    expect(wOETHAssetConfig.liquidateCollateralFactor).to.be.equal(cometWOETHAssetInfo.liquidateCollateralFactor);
    expect(wOETHAssetConfig.liquidationFactor).to.be.equal(cometWOETHAssetInfo.liquidationFactor);
    expect(wOETHAssetConfig.supplyCap).to.be.equal(cometWOETHAssetInfo.supplyCap);

    const configuratorWOETHAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[wOETHAssetIndex];
    expect(wOETHAssetConfig.asset).to.be.equal(configuratorWOETHAssetConfig.asset);
    expect(wOETHAssetConfig.decimals).to.be.equal(configuratorWOETHAssetConfig.decimals);
    expect(wOETHAssetConfig.borrowCollateralFactor).to.be.equal(configuratorWOETHAssetConfig.borrowCollateralFactor);
    expect(wOETHAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorWOETHAssetConfig.liquidateCollateralFactor);
    expect(wOETHAssetConfig.liquidationFactor).to.be.equal(configuratorWOETHAssetConfig.liquidationFactor);
    expect(wOETHAssetConfig.supplyCap).to.be.equal(configuratorWOETHAssetConfig.supplyCap);
  },
});
