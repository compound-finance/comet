import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const SFRXETH_ADDRESS = '0xac3E018457B222d93114458476f3E3416Abbe38F';
const SFRXETH_PRICE_FEED_ADDRESS = '0xB9af7723CfBd4469A7E8aa60B93428D648Bda99d';
let newPriceFeedAddress: string;

export default migration('1720779152_add_sfrxeth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _sfrxETHScalingPriceFeed = await deploymentManager.deploy(
      'sfrxETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        SFRXETH_PRICE_FEED_ADDRESS, // sfrxETH / ETH price feed
        8                           // decimals
      ]
    );
    return { sfrxETHScalingPriceFeed: _sfrxETHScalingPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { sfrxETHScalingPriceFeed }) {

    const trace = deploymentManager.tracer();

    const sfrxETH = await deploymentManager.existing(
      'sfrxETH',
      SFRXETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const sfrxEthPricefeed = await deploymentManager.existing(
      'sfrxETH:priceFeed',
      sfrxETHScalingPriceFeed,
      'mainnet'
    );

    newPriceFeedAddress = sfrxEthPricefeed.address;

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const sfrxETHAssetConfig = {
      asset: sfrxETH.address,
      priceFeed: sfrxEthPricefeed.address,
      decimals: await sfrxETH.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(5_000, 18), 
    };

    const mainnetActions = [
      // 1. Add sfrxETH as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, sfrxETHAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add sfrxETH as collateral into cWETHv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add sfrxETH into cWETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/listing-ethx-on-compound/4730/21).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/886) and [forum discussion](https://www.comp.xyz/t/listing-ethx-on-compound/4730).\n\n\n## Proposal Actions\n\nThe first proposal action adds sfrxETH asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';
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

    const sfrxETHAssetIndex = Number(await comet.numAssets()) - 1;

    const sfrxETH = await deploymentManager.existing(
      'sfrxETH',
      SFRXETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    
    const sfrxETHAssetConfig = {
      asset: sfrxETH.address,
      priceFeed: newPriceFeedAddress,
      decimals: await sfrxETH.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(5_000, 18),
    };

    // 1. Compare sfrxETH asset config with Comet and Configurator asset info
    const cometSfrxETHAssetInfo = await comet.getAssetInfoByAddress(
      SFRXETH_ADDRESS
    );
    expect(sfrxETHAssetIndex).to.be.equal(cometSfrxETHAssetInfo.offset);
    expect(sfrxETHAssetConfig.asset).to.be.equal(cometSfrxETHAssetInfo.asset);
    expect(exp(1, sfrxETHAssetConfig.decimals)).to.be.equal(
      cometSfrxETHAssetInfo.scale
    );
    expect(sfrxETHAssetConfig.borrowCollateralFactor).to.be.equal(
      cometSfrxETHAssetInfo.borrowCollateralFactor
    );
    expect(sfrxETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      cometSfrxETHAssetInfo.liquidateCollateralFactor
    );
    expect(sfrxETHAssetConfig.liquidationFactor).to.be.equal(
      cometSfrxETHAssetInfo.liquidationFactor
    );
    expect(sfrxETHAssetConfig.supplyCap).to.be.equal(
      cometSfrxETHAssetInfo.supplyCap
    );
    const configuratorSfrxETHAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[sfrxETHAssetIndex];
    expect(sfrxETHAssetConfig.asset).to.be.equal(
      configuratorSfrxETHAssetConfig.asset
    );
    expect(sfrxETHAssetConfig.decimals).to.be.equal(
      configuratorSfrxETHAssetConfig.decimals
    );
    expect(sfrxETHAssetConfig.borrowCollateralFactor).to.be.equal(
      configuratorSfrxETHAssetConfig.borrowCollateralFactor
    );
    expect(sfrxETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      configuratorSfrxETHAssetConfig.liquidateCollateralFactor
    );
    expect(sfrxETHAssetConfig.liquidationFactor).to.be.equal(
      configuratorSfrxETHAssetConfig.liquidationFactor
    );
    expect(sfrxETHAssetConfig.supplyCap).to.be.equal(
      configuratorSfrxETHAssetConfig.supplyCap
    );
  },
});
