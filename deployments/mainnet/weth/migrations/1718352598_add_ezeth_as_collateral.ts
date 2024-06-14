import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';


const EZETH_ADDRESS = '0xbf5495Efe5DB9ce00f80364C8B423567e58d2110';
const EZETH_PRICE_FEED_ADDRESS = '0x636A000262F6aA9e1F094ABF0aD8f645C44f641C';

export default migration('1718352598_add_ezeth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _ezETHScalingPriceFeed = await deploymentManager.deploy(
      'ezETH:priceFeed',
      'pricefeeds/EzETHExchangeRatePriceFeed.sol',
      [
        EZETH_PRICE_FEED_ADDRESS,    // ezETH / ETH exchange rate price feed
        8,                           // decimals
        'ezETH / ETH exchange rate', // description
      ]
    );
    return { ezETHScalingPriceFeed: _ezETHScalingPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { ezETHScalingPriceFeed }) {
    const trace = deploymentManager.tracer();

    const ezETH = await deploymentManager.existing(
      'ezETH',
      EZETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );

    const ezEthPricefeed = await deploymentManager.existing(
      'ezETH:priceFeed',
      ezETHScalingPriceFeed,
      'mainnet'
    );

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const ezETHAssetConfig = {
      asset: ezETH.address,
      priceFeed: ezEthPricefeed.address,
      decimals: await ezETH.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(2_900, 18), 
    };

    const mainnetActions = [
      // 1. Add ezETH as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, ezETHAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add rsETH, weETH and osETH as collaterals into cWETHv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add rsETH, weETH  and osETH into cWETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet weETH](https://www.comp.xyz/t/add-weeth-market-on-ethereum/5179/3), [recommendations from Gauntlet rsETH](https://www.comp.xyz/t/add-rseth-market-on-ethereum-mainnet/5118/8) and [recommendations from Gauntlet osETH](https://www.comp.xyz/t/add-oseth-as-a-collateral-on-ethereum-mainnet/5272/2).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/854), [deploy market GitHub action run]() and [forum discussion weETH](https://www.comp.xyz/t/add-weeth-market-on-ethereum/5179), [forum discussion rsETH](https://www.comp.xyz/t/add-rseth-market-on-ethereum-mainnet/5118) and [forum discussion osETH](https://www.comp.xyz/t/add-oseth-as-a-collateral-on-ethereum-mainnet/5272).\n\n\n## Proposal Actions\n\nThe first proposal action adds rsETH asset as collateral with corresponding configurations.\n\nThe second action adds weETH asset as collateral with corresponding configurations.\n\nThe third action adds osETH asset as collateral with corresponding configurations.\n\nThe fourth action sets new Annual Supply Interest Rate Slope High to 100%.\n\nThe fifth action sets new Annual Borrow Interest Rate Slope High to 115%.\n\nThe sixth action deploys and upgrades Comet to a new version.';
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

    const ezETHAssetIndex = Number(await comet.numAssets()) - 1;

    const ezETH = await deploymentManager.existing(
      'ezETH',
      EZETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    
    const ezETHAssetConfig = {
      asset: ezETH.address,
      priceFeed: '',
      decimals: await ezETH.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(2_900, 18), // 2_900
    };

    // 1. & 2. Compare ezETH asset config with Comet and Configurator asset info
    const cometEzETHAssetInfo = await comet.getAssetInfoByAddress(
      EZETH_ADDRESS
    );
    expect(ezETHAssetIndex).to.be.equal(cometEzETHAssetInfo.offset);
    expect(ezETHAssetConfig.asset).to.be.equal(cometEzETHAssetInfo.asset);
    expect(exp(1, ezETHAssetConfig.decimals)).to.be.equal(
      cometEzETHAssetInfo.scale
    );
    expect(ezETHAssetConfig.borrowCollateralFactor).to.be.equal(
      cometEzETHAssetInfo.borrowCollateralFactor
    );
    expect(ezETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      cometEzETHAssetInfo.liquidateCollateralFactor
    );
    expect(ezETHAssetConfig.liquidationFactor).to.be.equal(
      cometEzETHAssetInfo.liquidationFactor
    );
    expect(ezETHAssetConfig.supplyCap).to.be.equal(
      cometEzETHAssetInfo.supplyCap
    );
    const configuratorEsETHAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[ezETHAssetIndex];
    expect(ezETHAssetConfig.asset).to.be.equal(
      configuratorEsETHAssetConfig.asset
    );
    expect(ezETHAssetConfig.decimals).to.be.equal(
      configuratorEsETHAssetConfig.decimals
    );
    expect(ezETHAssetConfig.borrowCollateralFactor).to.be.equal(
      configuratorEsETHAssetConfig.borrowCollateralFactor
    );
    expect(ezETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      configuratorEsETHAssetConfig.liquidateCollateralFactor
    );
    expect(ezETHAssetConfig.liquidationFactor).to.be.equal(
      configuratorEsETHAssetConfig.liquidationFactor
    );
    expect(ezETHAssetConfig.supplyCap).to.be.equal(
      configuratorEsETHAssetConfig.supplyCap
    );
  },
});