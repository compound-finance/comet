import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const RSETH_ADDRESS = '0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7';
const RSETH_PRICE_FEED_ADDRESS = '0x03c68933f7a3F76875C0bc670a58e69294cDFD01';

export default migration('1718972942_add_rseth_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _rsETHScalingPriceFeed = await deploymentManager.deploy(
      'rsETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        RSETH_PRICE_FEED_ADDRESS, // rsETH / ETH price feed
        8                         // decimals
      ]
    );
    return { rsETHScalingPriceFeed: _rsETHScalingPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { rsETHScalingPriceFeed }) {

    const trace = deploymentManager.tracer();

    const rsETH = await deploymentManager.existing(
      'rsETH',
      RSETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const rsEthPricefeed = await deploymentManager.existing(
      'rsETH:priceFeed',
      rsETHScalingPriceFeed,
      'mainnet'
    );

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const rsETHAssetConfig = {
      asset: rsETH.address,
      priceFeed: rsEthPricefeed.address,
      decimals: await rsETH.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(5_000, 18), 
    };

    const mainnetActions = [
      // 1. Add rsETH as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, rsETHAssetConfig],
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

    const description = '# Add rsETH as collateral into cWETHv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add rsETH into cWETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet rsETH](https://www.comp.xyz/t/add-rseth-market-on-ethereum-mainnet/5118/8).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/870) and [forum discussion rsETH](https://www.comp.xyz/t/add-rseth-market-on-ethereum-mainnet/5118).\n\n\n## Proposal Actions\n\nThe first proposal action adds rsETH asset as collateral with corresponding configurations.\n\nThe second action sets new Annual Supply Interest Rate Slope High to 100%.\n\nThe third action sets new Annual Borrow Interest Rate Slope High to 115%.\n\nThe fourth action deploys and upgrades Comet to a new version.';
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

    const rsETHAssetIndex = Number(await comet.numAssets()) - 1;

    const rsETH = await deploymentManager.existing(
      'rsETH',
      RSETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    
    const rsETHAssetConfig = {
      asset: rsETH.address,
      priceFeed: '',
      decimals: await rsETH.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(5_000, 18), // 5_000
    };

    // 1. Compare rsETH asset config with Comet and Configurator asset info
    const cometRsETHAssetInfo = await comet.getAssetInfoByAddress(
      RSETH_ADDRESS
    );
    expect(rsETHAssetIndex).to.be.equal(cometRsETHAssetInfo.offset);
    expect(rsETHAssetConfig.asset).to.be.equal(cometRsETHAssetInfo.asset);
    expect(exp(1, rsETHAssetConfig.decimals)).to.be.equal(
      cometRsETHAssetInfo.scale
    );
    expect(rsETHAssetConfig.borrowCollateralFactor).to.be.equal(
      cometRsETHAssetInfo.borrowCollateralFactor
    );
    expect(rsETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      cometRsETHAssetInfo.liquidateCollateralFactor
    );
    expect(rsETHAssetConfig.liquidationFactor).to.be.equal(
      cometRsETHAssetInfo.liquidationFactor
    );
    expect(rsETHAssetConfig.supplyCap).to.be.equal(
      cometRsETHAssetInfo.supplyCap
    );
    const configuratorRsETHAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[rsETHAssetIndex];
    expect(rsETHAssetConfig.asset).to.be.equal(
      configuratorRsETHAssetConfig.asset
    );
    expect(rsETHAssetConfig.decimals).to.be.equal(
      configuratorRsETHAssetConfig.decimals
    );
    expect(rsETHAssetConfig.borrowCollateralFactor).to.be.equal(
      configuratorRsETHAssetConfig.borrowCollateralFactor
    );
    expect(rsETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      configuratorRsETHAssetConfig.liquidateCollateralFactor
    );
    expect(rsETHAssetConfig.liquidationFactor).to.be.equal(
      configuratorRsETHAssetConfig.liquidationFactor
    );
    expect(rsETHAssetConfig.supplyCap).to.be.equal(
      configuratorRsETHAssetConfig.supplyCap
    );
    
    // 2. Check new Annual Supply Interest Rate Slope High
    expect(exp(1, 18) / BigInt(31_536_000)).to.be.equal(await comet.supplyPerSecondInterestRateSlopeHigh());

    // 3. Check new Annual Borrow Interest Rate Slope High
    expect(exp(1.15, 18) / BigInt(31_536_000)).to.be.equal(await comet.borrowPerSecondInterestRateSlopeHigh());
  },
});
