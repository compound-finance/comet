import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';


const RSETH_ADDRESS = '0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7';
const RSETH_PRICE_FEED_ADDRESS = '0x03c68933f7a3F76875C0bc670a58e69294cDFD01';

const WEETH_ADDRESS = '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee';
const WEETH_PRICE_FEED_ADDRESS = '0x5c9C449BbC9a6075A2c061dF312a35fd1E05fF22';

let rsETHScalingPriceFeed = '';
let weETHScalingPriceFeed = '';
export default migration('1716798961_add_rseth_and_weeth', {
  prepare: async (deploymentManager: DeploymentManager) => {
    const _rsETHScalingPriceFeed = await deploymentManager.deploy(
      'rsETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        RSETH_PRICE_FEED_ADDRESS, // rsETH / ETH price feed
        8                                             // decimals
      ]
    );
    const _weETHScalingPriceFeed = await deploymentManager.deploy(
      'weETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        WEETH_PRICE_FEED_ADDRESS, // weETH / ETH price feed
        8                                             // decimals
      ]
    );
    rsETHScalingPriceFeed = _rsETHScalingPriceFeed.address;
    weETHScalingPriceFeed = _weETHScalingPriceFeed.address;
    return { };
  },

  async enact(deploymentManager: DeploymentManager) {

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

    const rsETHAssetConfig = {
      asset: rsETH.address,
      priceFeed: rsEthPricefeed.address,
      decimals: await rsETH.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(0, 18), // 5_000
    };
    
    const weETHAssetConfig = {
      asset: weETH.address,
      priceFeed: weEthPricefeed.address,
      decimals: await weETH.decimals(),
      borrowCollateralFactor: exp(0.82, 18),
      liquidateCollateralFactor: exp(0.87, 18),
      liquidationFactor: exp(0.92, 18),
      supplyCap: exp(0, 18), // 22_500
    };

    const mainnetActions = [
      // 1. Add rsETH as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, rsETHAssetConfig],
      },
      // 2. Add weETH as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, weETHAssetConfig],
      },
      // 3. Set new Annual Supply Interest Rate Slope High to 100%
      {
        contract: configurator,
        signature: 'setSupplyPerYearInterestRateSlopeHigh(address,uint64)',
        args: [
          comet.address,
          exp(1, 18)  // newSupplyPerYearInterestRateSlopeHigh
        ],
      },
      // 4. Set new Annual Borrow Interest Rate Slope High to 115%
      {
        contract: configurator,
        signature: 'setBorrowPerYearInterestRateSlopeHigh(address,uint64)',
        args: [
          comet.address,
          exp(1.15, 18)  // newBorrowPerYearInterestRateSlopeHigh
        ],
      },
      // 5. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add rsETH and weETH as collaterals into cWETHv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add rsETH and weETH into cWETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet weETH](https://www.comp.xyz/t/add-weeth-market-on-ethereum/5179/3) and  [recommendations from Gauntlet rsETH](https://www.comp.xyz/t/add-rseth-market-on-ethereum-mainnet/5118/8).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/854), [deploy market GitHub action run]() and [forum discussion weETH](https://www.comp.xyz/t/add-weeth-market-on-ethereum/5179) and [forum discussion rsETH](https://www.comp.xyz/t/add-rseth-market-on-ethereum-mainnet/5118).\n\n\n## Proposal Actions\n\nThe first proposal action adds rsETH asset as collateral with corresponding configurations.\n\nThe second action adds weETH asset as collateral with corresponding configurations.\n\nThe third action sets new Annual Supply Interest Rate Slope High to 100%.\n\nThe fourth action sets new Annual Borrow Interest Rate Slope High to 115%.\n\nThe fifth action deploys and upgrades Comet to a new version.\n';
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

    const rsETHAssetIndex = Number(await comet.numAssets()) - 2;
    const weETHAssetIndex = Number(await comet.numAssets()) - 1;

    const rsETH = await deploymentManager.existing(
      'rsETH',
      RSETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const weETH = await deploymentManager.existing(
      'weETH',
      WEETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    
    const rsETHAssetConfig = {
      asset: rsETH.address,
      priceFeed: rsETHScalingPriceFeed,
      decimals: await rsETH.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(0, 18), // 5_000
    };
    
    const weETHAssetConfig = {
      asset: weETH.address,
      priceFeed: weETHScalingPriceFeed,
      decimals: await weETH.decimals(),
      borrowCollateralFactor: exp(0.82, 18),
      liquidateCollateralFactor: exp(0.87, 18),
      liquidationFactor: exp(0.92, 18),
      supplyCap: exp(0, 18), // 22_500
    };

    // 1. Compare proposed asset config with Comet asset info
    const cometRsETHAssetInfo = await comet.getAssetInfoByAddress(
      RSETH_ADDRESS
    );
    expect(rsETHAssetIndex).to.be.equal(cometRsETHAssetInfo.offset);
    expect(rsETHAssetConfig.asset).to.be.equal(cometRsETHAssetInfo.asset);
    expect(rsETHAssetConfig.priceFeed).to.be.equal(
      cometRsETHAssetInfo.priceFeed
    );
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
    
    const cometWeETHAssetInfo = await comet.getAssetInfoByAddress(
      WEETH_ADDRESS
    );
    expect(weETHAssetIndex).to.be.equal(cometWeETHAssetInfo.offset);
    expect(weETHAssetConfig.asset).to.be.equal(cometWeETHAssetInfo.asset);
    expect(weETHAssetConfig.priceFeed).to.be.equal(
      cometWeETHAssetInfo.priceFeed
    );
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

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorRsETHAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[rsETHAssetIndex];
    expect(rsETHAssetConfig.asset).to.be.equal(
      configuratorRsETHAssetConfig.asset
    );
    expect(rsETHAssetConfig.priceFeed).to.be.equal(
      configuratorRsETHAssetConfig.priceFeed
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

    const configuratorWeETHAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[weETHAssetIndex];
    expect(weETHAssetConfig.asset).to.be.equal(
      configuratorWeETHAssetConfig.asset
    );
    expect(weETHAssetConfig.priceFeed).to.be.equal(
      configuratorWeETHAssetConfig.priceFeed
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

    // 3. Check new Annual Supply Interest Rate Slope High
    expect(exp(1, 18) / BigInt(31_536_000)).to.be.equal(await comet.supplyPerSecondInterestRateSlopeHigh());

    // 4. Check new Annual Borrow Interest Rate Slope High
    expect(exp(1.15, 18) / BigInt(31_536_000)).to.be.equal(await comet.borrowPerSecondInterestRateSlopeHigh());
  },
});
