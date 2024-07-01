import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const WEETH_ADDRESS = '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee';
const WEETH_PRICE_FEED_ADDRESS = '0x5c9C449BbC9a6075A2c061dF312a35fd1E05fF22';

export default migration('1718968177_add_weeth_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _weETHScalingPriceFeed = await deploymentManager.deploy(
      'weETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        WEETH_PRICE_FEED_ADDRESS, // weETH / ETH price feed
        8                         // decimals
      ]
    );
    return { weETHScalingPriceFeed: _weETHScalingPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { weETHScalingPriceFeed }) {

    const trace = deploymentManager.tracer();

    const weETH = await deploymentManager.existing(
      'weETH',
      WEETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const weEthPricefeed = await deploymentManager.existing(
      'weETH:priceFeed',
      weETHScalingPriceFeed,
      'mainnet'
    );

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    // https://www.comp.xyz/t/add-weeth-market-on-ethereum/5179/3
    const weETHAssetConfig = {
      asset: weETH.address,
      priceFeed: weEthPricefeed.address,
      decimals: await weETH.decimals(),
      borrowCollateralFactor: exp(0.82, 18),
      liquidateCollateralFactor: exp(0.87, 18),
      liquidationFactor: exp(0.92, 18),
      supplyCap: exp(22_500, 18),
    };

    const mainnetActions = [
      // 1. Add weETH as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, weETHAssetConfig],
      },
      // 2. Set new Annual Supply Interest Rate Slope High to 100%
      {
        contract: configurator,
        signature: 'setSupplyPerYearInterestRateSlopeHigh(address,uint64)',
        args: [
          comet.address,
          exp(1, 18)  // newSupplyPerYearInterestRateSlopeHigh
        ],
      },
      // 3. Set new Annual Borrow Interest Rate Slope High to 115%
      {
        contract: configurator,
        signature: 'setBorrowPerYearInterestRateSlopeHigh(address,uint64)',
        args: [
          comet.address,
          exp(1.15, 18)  // newBorrowPerYearInterestRateSlopeHigh
        ],
      },
      // 4. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add weETH as collateral into cWETHv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add weETH into cWETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet weETH](https://www.comp.xyz/t/add-weeth-market-on-ethereum/5179/3).\n\nFurther detailed information can be found on the corresponding [proposal pull request](PR - https://github.com/compound-finance/comet/pull/869) and [forum discussion weETH](https://www.comp.xyz/t/add-weeth-market-on-ethereum/5179).\n\n\n## Proposal Actions\n\nThe first proposal action adds weETH asset as collateral with corresponding configurations.\n\nThe second action sets new Annual Supply Interest Rate Slope High to 100%.\n\nThe third action sets new Annual Borrow Interest Rate Slope High to 115%.\n\nThe fourth action deploys and upgrades Comet to a new version.';
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

    const weETHAssetIndex = Number(await comet.numAssets()) - 1;

    const weETH = await deploymentManager.existing(
      'weETH',
      WEETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );

    const weETHAssetConfig = {
      asset: weETH.address,
      priceFeed: '',
      decimals: await weETH.decimals(),
      borrowCollateralFactor: exp(0.82, 18),
      liquidateCollateralFactor: exp(0.87, 18),
      liquidationFactor: exp(0.92, 18),
      supplyCap: exp(22_500, 18)
    };

    // 1. Compare weETH asset config with Comet and Configurator asset config    
    const cometWeETHAssetInfo = await comet.getAssetInfoByAddress(
      WEETH_ADDRESS
    );
    expect(weETHAssetIndex).to.be.equal(cometWeETHAssetInfo.offset);
    expect(weETHAssetConfig.asset).to.be.equal(cometWeETHAssetInfo.asset);
    expect(exp(1, weETHAssetConfig.decimals)).to.be.equal(
      cometWeETHAssetInfo.scale
    );
    expect(weETHAssetConfig.borrowCollateralFactor).to.be.equal(
      cometWeETHAssetInfo.borrowCollateralFactor
    );
    expect(weETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      cometWeETHAssetInfo.liquidateCollateralFactor
    );
    expect(weETHAssetConfig.liquidationFactor).to.be.equal(
      cometWeETHAssetInfo.liquidationFactor
    );
    expect(weETHAssetConfig.supplyCap).to.be.equal(
      cometWeETHAssetInfo.supplyCap
    );

    const configuratorWeETHAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[weETHAssetIndex];
    expect(weETHAssetConfig.asset).to.be.equal(
      configuratorWeETHAssetConfig.asset
    );
    expect(weETHAssetConfig.decimals).to.be.equal(
      configuratorWeETHAssetConfig.decimals
    );
    expect(weETHAssetConfig.borrowCollateralFactor).to.be.equal(
      configuratorWeETHAssetConfig.borrowCollateralFactor
    );
    expect(weETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      configuratorWeETHAssetConfig.liquidateCollateralFactor
    );
    expect(weETHAssetConfig.liquidationFactor).to.be.equal(
      configuratorWeETHAssetConfig.liquidationFactor
    );
    expect(weETHAssetConfig.supplyCap).to.be.equal(
      configuratorWeETHAssetConfig.supplyCap
    );

    // 2. Check new Annual Supply Interest Rate Slope High
    expect(exp(1, 18) / BigInt(31_536_000)).to.be.equal(await comet.supplyPerSecondInterestRateSlopeHigh());

    // 3. Check new Annual Borrow Interest Rate Slope High
    expect(exp(1.15, 18) / BigInt(31_536_000)).to.be.equal(await comet.borrowPerSecondInterestRateSlopeHigh());
  },
});
