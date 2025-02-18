import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';


const weETH_ADDRESS = '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee';
const weETH_ETH_PRICE_FEED_ADDRESS = '0x1Ad4CEBa9f8135A557bBe317DB62Aa125C330F26';
const ETH_USD_PRICE_FEED_ADDRESS = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';

export default migration('1739871588_add_weeth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const weethMultiplicativePriceFeed = await deploymentManager.deploy(
      'weETH:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        weETH_ETH_PRICE_FEED_ADDRESS,  // weETH / eETH price feed
        ETH_USD_PRICE_FEED_ADDRESS,   // ETH / USD price feed 
        8,                            // decimals
        'weETH / USD price feed'
      ]
    );
    return { weethPriceFeedAddress: weethMultiplicativePriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { weethPriceFeedAddress }) {
    const trace = deploymentManager.tracer();

    const weETH = await deploymentManager.existing(
      'weETH',
      weETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );

    const weethPricefeed = await deploymentManager.existing(
      'weETH:priceFeed',
      weethPriceFeedAddress,
      'mainnet'
    );

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const weethAssetConfig = {
      asset: weETH.address,
      priceFeed: weethPricefeed.address,
      decimals: await weETH.decimals(),
      borrowCollateralFactor: exp(0.70, 18),
      liquidateCollateralFactor: exp(0.75, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(12_000, 18), 
    };

    const mainnetActions = [
      // 1. Add ezETH as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, weethAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add weETH as collateral into cWETHv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add weETH into cWETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-weeth-to-weth-comets-on-ethereum-and-arbitrum/5332/1).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/868) and [forum discussion](https://www.comp.xyz/t/add-weeth-to-weth-comets-on-ethereum-and-arbitrum/5332).\n\n\n## Proposal Actions\n\nThe first proposal action adds weETH asset as collateral with the corresponding configuration.\n\nThe second action deploys and upgrades Comet to a new version.';
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
    return false;
  }, 

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const weethAssetIndex = Number(await comet.numAssets()) - 1;

    const weETH = await deploymentManager.existing(
      'weETH',
      weETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    
    const weethAssetConfig = {
      asset: weETH.address,
      priceFeed: '',
      decimals: await weETH.decimals(),
      borrowCollateralFactor: exp(0.70, 18),
      liquidateCollateralFactor: exp(0.75, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(12_000, 18), 
    };

    // 1. & 2. Compare weETH asset config with Comet and Configurator asset info
    const cometweETHHAssetInfo = await comet.getAssetInfoByAddress(
      weETH_ADDRESS
    );

    expect(weethAssetIndex).to.be.equal(cometweETHHAssetInfo.offset);
    expect(weethAssetConfig.asset).to.be.equal(cometweETHHAssetInfo.asset);
    expect(exp(1, weethAssetConfig.decimals)).to.be.equal(
      cometweETHHAssetInfo.scale
    );
    expect(weethAssetConfig.borrowCollateralFactor).to.be.equal(
      cometweETHHAssetInfo.borrowCollateralFactor
    );
    expect(weethAssetConfig.liquidateCollateralFactor).to.be.equal(
      cometweETHHAssetInfo.liquidateCollateralFactor
    );
    expect(weethAssetConfig.liquidationFactor).to.be.equal(
      cometweETHHAssetInfo.liquidationFactor
    );
    expect(weethAssetConfig.supplyCap).to.be.equal(
      cometweETHHAssetInfo.supplyCap
    );
    const configuratorEsETHAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[weethAssetIndex];
    expect(weethAssetConfig.asset).to.be.equal(
      configuratorEsETHAssetConfig.asset
    );
    expect(weethAssetConfig.decimals).to.be.equal(
      configuratorEsETHAssetConfig.decimals
    );
    expect(weethAssetConfig.borrowCollateralFactor).to.be.equal(
      configuratorEsETHAssetConfig.borrowCollateralFactor
    );
    expect(weethAssetConfig.liquidateCollateralFactor).to.be.equal(
      configuratorEsETHAssetConfig.liquidateCollateralFactor
    );
    expect(weethAssetConfig.liquidationFactor).to.be.equal(
      configuratorEsETHAssetConfig.liquidationFactor
    );
    expect(weethAssetConfig.supplyCap).to.be.equal(
      configuratorEsETHAssetConfig.supplyCap
    );
  },
});