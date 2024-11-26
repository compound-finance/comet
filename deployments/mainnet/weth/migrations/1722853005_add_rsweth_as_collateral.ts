import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const RSWETH_ADDRESS = '0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0';
let newPriceFeedAddress: string;

export default migration('1722853005_add_rsweth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _rswETHPriceFeed = await deploymentManager.deploy(
      'rswETH:priceFeed',
      'pricefeeds/RateBasedScalingPriceFeed.sol',
      [
        RSWETH_ADDRESS,                        // rswETH / ETH price feed
        8,                                     // decimals
        18,                                    // oracleDecimals
        'rswETH/ETH exchange rate price feed', // description
      ]
    );
    return { rswETHPriceFeed: _rswETHPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { rswETHPriceFeed }) {

    const trace = deploymentManager.tracer();

    const rswETH = await deploymentManager.existing(
      'rswETH',
      RSWETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const rswEthPricefeed = await deploymentManager.existing(
      'rswETH:priceFeed',
      rswETHPriceFeed,
      'mainnet'
    );

    newPriceFeedAddress = rswEthPricefeed.address;

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const rswETHAssetConfig = {
      asset: rswETH.address,
      priceFeed: rswEthPricefeed.address,
      decimals: await rswETH.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(1_000, 18), 
    };

    const mainnetActions = [
      // 1. Add rswETH as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, rswETHAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add rswETH as collateral into cWETHv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add rswETH into cWETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/add-rsweth-as-collateral-to-eth-market-on-mainnet/5308/3).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/885) and [forum discussion](https://www.comp.xyz/t/add-rsweth-as-collateral-to-eth-market-on-mainnet/5308).\n\n\n## Proposal Actions\n\nThe first proposal action adds rswETH asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';
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
    return true;
  }, 

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const rswETHAssetIndex = Number(await comet.numAssets()) - 1;

    const rswETH = await deploymentManager.existing(
      'rswETH',
      RSWETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    
    const rswETHAssetConfig = {
      asset: rswETH.address,
      priceFeed: newPriceFeedAddress,
      decimals: await rswETH.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(1_000, 18),
    };

    // 1. Compare rswETH asset config with Comet and Configurator asset info
    const cometRswETHAssetInfo = await comet.getAssetInfoByAddress(RSWETH_ADDRESS);
    expect(rswETHAssetIndex).to.be.equal(cometRswETHAssetInfo.offset);
    expect(rswETHAssetConfig.asset).to.be.equal(cometRswETHAssetInfo.asset);
    expect(exp(1, rswETHAssetConfig.decimals)).to.be.equal(cometRswETHAssetInfo.scale);
    expect(rswETHAssetConfig.borrowCollateralFactor).to.be.equal(cometRswETHAssetInfo.borrowCollateralFactor);
    expect(rswETHAssetConfig.liquidateCollateralFactor).to.be.equal(cometRswETHAssetInfo.liquidateCollateralFactor);
    expect(rswETHAssetConfig.liquidationFactor).to.be.equal(cometRswETHAssetInfo.liquidationFactor);
    expect(rswETHAssetConfig.supplyCap).to.be.equal(cometRswETHAssetInfo.supplyCap);

    const configuratorRswETHAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[rswETHAssetIndex];
    expect(rswETHAssetConfig.asset).to.be.equal(configuratorRswETHAssetConfig.asset);
    expect(rswETHAssetConfig.decimals).to.be.equal(configuratorRswETHAssetConfig.decimals);
    expect(rswETHAssetConfig.borrowCollateralFactor).to.be.equal(configuratorRswETHAssetConfig.borrowCollateralFactor);
    expect(rswETHAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorRswETHAssetConfig.liquidateCollateralFactor);
    expect(rswETHAssetConfig.liquidationFactor).to.be.equal(configuratorRswETHAssetConfig.liquidationFactor);
    expect(rswETHAssetConfig.supplyCap).to.be.equal(configuratorRswETHAssetConfig.supplyCap);
  },
});
