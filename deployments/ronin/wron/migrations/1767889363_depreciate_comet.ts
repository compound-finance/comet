import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal, exp } from '../../../../src/deploy';
import { utils, constants } from 'ethers';

const destinationChainSelector = '6916147374840168594';

const USDC_TO_USD_API3_PRICE_FEED_ADDRESS = '0xf061d556F5136263c4d66d9fFCADE8Ab43a3a704';
const RON_TO_USD_API3_PRICE_FEED_ADDRESS = '0xA708247a64Fad46874A57BA274451a8a1A1daa0c';
const ETH_TO_USD_API3_PRICE_FEED_ADDRESS = '0xbBF6e0D078c7F5750d0732cD8f3EACe9A87b2b58';

const CONSTANT_PRICE_FEED = '0x8AC2b57d15c84755A3333aD68025d2496AE3BeBD';

let newPriceFeedUSDCAddress: string;
let newPriceFeedWRONAddress: string;
let newPriceFeedWETHAddress: string;
let newPriceFeedAXSAddress: string;

let oldUSDCPriceFeed: string;
let oldWRONPriceFeed: string;
let oldWETHPriceFeed: string;
let oldAXSPriceFeed: string;

export default migration('1767889363_depreciate_comet', {
  async prepare(deploymentManager: DeploymentManager) {
    const _usdcPriceFeed = await deploymentManager.deploy(
      'USDC:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        USDC_TO_USD_API3_PRICE_FEED_ADDRESS, // USDC / USD price feed
        8                                    // decimals
      ]
    );

    const _wronPriceFeed = await deploymentManager.deploy(
      'WRON:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        RON_TO_USD_API3_PRICE_FEED_ADDRESS, // WRON / USD price feed
        8,                                  // decimals
      ],
      true
    );

    const _wethPriceFeed = await deploymentManager.deploy(
      'WETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        ETH_TO_USD_API3_PRICE_FEED_ADDRESS, // WETH / USD price feed
        8,                                  // decimals
      ],
      true
    );

    return {
      USDCPriceFeedAddress: _usdcPriceFeed.address,
      WRONPriceFeedAddress: _wronPriceFeed.address,
      WETHPriceFeedAddress: _wethPriceFeed.address,
    };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    { 
      USDCPriceFeedAddress,
      WRONPriceFeedAddress,
      WETHPriceFeedAddress,
    }
  ) => {
    const trace = deploymentManager.tracer();
    newPriceFeedUSDCAddress = USDCPriceFeedAddress;
    newPriceFeedWRONAddress = WRONPriceFeedAddress;
    newPriceFeedWETHAddress = WETHPriceFeedAddress;
    newPriceFeedAXSAddress = CONSTANT_PRICE_FEED;

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      USDC,
      AXS,
      WETH,
    } = await deploymentManager.getContracts();

    const {
      governor, 
      l1CCIPRouter
    } = await govDeploymentManager.getContracts();

    const usdcAssetConfig = {
      asset: USDC.address,
      priceFeed: newPriceFeedUSDCAddress,
      decimals: await USDC.decimals(),
      borrowCollateralFactor: exp(0.50, 18),
      liquidateCollateralFactor: exp(0.80, 18),
      liquidationFactor: exp(0.80, 18),
      supplyCap: 0,
    };

    const wethAssetConfig = {
      asset: WETH.address,
      priceFeed: newPriceFeedWETHAddress,
      decimals: await WETH.decimals(),
      borrowCollateralFactor: exp(0.50, 18),
      liquidateCollateralFactor: exp(0.80, 18),
      liquidationFactor: exp(0.80, 18),
      supplyCap: 0,
    };  

    const axsAssetConfig = {
      asset: AXS.address,
      priceFeed: newPriceFeedAXSAddress,
      decimals: await AXS.decimals(),
      borrowCollateralFactor: exp(0.50, 18),
      liquidateCollateralFactor: exp(0.78, 18),
      liquidationFactor: exp(0.75, 18),
      supplyCap: 0,
    };

    const updateWRONPriceFeedCalldata = await calldata(
      configurator.populateTransaction.setBaseTokenPriceFeed(
        comet.address,
        newPriceFeedWRONAddress
      )
    );

    const updateUSDCAssetCalldata = await calldata(
      configurator.populateTransaction.updateAsset(
        comet.address,
        usdcAssetConfig
      )
    );

    const updateWETHAssetCalldata = await calldata(
      configurator.populateTransaction.updateAsset(
        comet.address,
        wethAssetConfig
      )
    );

    const updateAXSAssetCalldata = await calldata(
      configurator.populateTransaction.updateAsset(
        comet.address,
        axsAssetConfig
      )
    );

    const setBorrowPerYearInterestRateBaseCalldata = await calldata(
      configurator.populateTransaction.setBorrowPerYearInterestRateBase(
        comet.address,
        exp(0.025, 18) // 2.5% supply interest rate
      )
    );

    const setBorrowPerYearInterestRateSlopeLowCalldata = await calldata(
      configurator.populateTransaction.setBorrowPerYearInterestRateSlopeLow(
        comet.address,
        exp(0.017647, 18) // 1.7647% borrow interest rate slope low
      )
    );

    const setBorrowKinkCalldata = await calldata(
      configurator.populateTransaction.setBorrowKink(
        comet.address,
        exp(0.85, 18) // 85% borrow kink
      )
    );

    const setBorrowPerYearInterestRateSlopeHighCalldata = await calldata(
      configurator.populateTransaction.setBorrowPerYearInterestRateSlopeHigh(
        comet.address,
        exp(0.732667, 18) // 73.2667% borrow interest rate slope high
      )
    );

    const setSupplyPerYearInterestRateBaseCalldata = await calldata(
      configurator.populateTransaction.setSupplyPerYearInterestRateBase(
        comet.address,
        0 // 0% supply interest rate
      )
    );

    const setSupplyPerYearInterestRateSlopeLowCalldata = await calldata(
      configurator.populateTransaction.setSupplyPerYearInterestRateSlopeLow(
        comet.address,
        exp(0.02, 18) // 2% supply interest rate slope low
      )
    );

    const setSupplyKinkCalldata = await calldata(
      configurator.populateTransaction.setSupplyKink(
        comet.address,
        exp(0.85, 18) // 85% supply kink
      )
    );

    const setSupplyPerYearInterestRateSlopeHighCalldata = await calldata(
      configurator.populateTransaction.setSupplyPerYearInterestRateSlopeHigh(
        comet.address,
        exp(0.868012, 18) // 86.8012% supply interest rate slope high
      )
    );

    const deployAndUpgradeToCalldata = await calldata(
      cometAdmin.populateTransaction.deployAndUpgradeTo(
        configurator.address,
        comet.address
      )
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          cometAdmin.address
        ],
        [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
        ],
        [
          'setBaseTokenPriceFeed(address,address)',
          'updateAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'updateAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'updateAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'setBorrowPerYearInterestRateBase(address,uint64)',
          'setBorrowPerYearInterestRateSlopeLow(address,uint64)',
          'setBorrowKink(address,uint64)',
          'setBorrowPerYearInterestRateSlopeHigh(address,uint64)',
          'setSupplyPerYearInterestRateBase(address,uint64)',
          'setSupplyPerYearInterestRateSlopeLow(address,uint64)',
          'setSupplyKink(address,uint64)',
          'setSupplyPerYearInterestRateSlopeHigh(address,uint64)',
          'deployAndUpgradeTo(address,address)'
        ],
        [
          updateWRONPriceFeedCalldata,
          updateUSDCAssetCalldata,
          updateWETHAssetCalldata,
          updateAXSAssetCalldata,
          setBorrowPerYearInterestRateBaseCalldata,
          setBorrowPerYearInterestRateSlopeLowCalldata,
          setBorrowKinkCalldata,
          setBorrowPerYearInterestRateSlopeHighCalldata,
          setSupplyPerYearInterestRateBaseCalldata,
          setSupplyPerYearInterestRateSlopeLowCalldata,
          setSupplyKinkCalldata,
          setSupplyPerYearInterestRateSlopeHighCalldata,
          deployAndUpgradeToCalldata
        ],
      ]
    );

    [,, oldUSDCPriceFeed] = await comet.getAssetInfoByAddress(USDC.address);
    oldWRONPriceFeed = await comet.baseTokenPriceFeed();
    [,, oldWETHPriceFeed] = await comet.getAssetInfoByAddress(WETH.address);
    [,, oldAXSPriceFeed] = await comet.getAssetInfoByAddress(AXS.address);

    const fee = await l1CCIPRouter.getFee(destinationChainSelector, [
      utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
      l2ProposalData,
      [],
      constants.AddressZero,
      '0x'
    ]);

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo WETH Comet on Ronin.
      {
        contract: l1CCIPRouter,
        signature: 'ccipSend(uint64,(bytes,bytes,(address,uint256)[],address,bytes))',
        args:
            [
              destinationChainSelector,
              [
                utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
                l2ProposalData,
                [],
                constants.AddressZero,
                '0x'
              ]
            ],
        value: fee
      },
    ];

    const description = `# Depreciate cWRONv3 on Ronin

## Proposal summary

This proposal updates price feeds to API3, since Chainlink soon will no longer support Ronin and updates interest rate curve parameters for WRON market on Ronin.

It is done to prevent new suppliers from entering the market, reduces capital efficiency, making the market less appealing without causing users to become liquidatable and raises liquidation penalty to further disincentivizes usage by increasing the cost of liquidation, while reducing risk to the comet.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1084) and [forum discussion](https://www.comp.xyz/t/gauntlet-depreciating-ronin-weth-and-wron-comets/7308).

## Proposal actions

The proposal sends the following encoded calls to the governance receiver on Ronin:
- Update USDC, WETH, AXS, and WRON price feeds to API3 oracle
- Set supply caps to 0 for all collateral assets
- Reduce collateral factors
- Increase liquidation penalties
- Update interest rate curve parameters:
  - \`setBorrowPerYearInterestRateBase\`
  - \`setBorrowPerYearInterestRateSlopeLow\`
  - \`setBorrowKink\`
  - \`setBorrowPerYearInterestRateSlopeHigh\`
  - \`setSupplyPerYearInterestRateBase\`
  - \`setSupplyPerYearInterestRateSlopeLow\`
  - \`setSupplyKink\`
  - \`setSupplyPerYearInterestRateSlopeHigh\`
- Deploy and upgrade to new configuration via \`deployAndUpgradeTo\`.
`;

    const txn = await govDeploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      ), 0, 300_000
    );

    const event = txn.events.find(
      (event: { event: string }) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      configurator,
      USDC,      
      WETH,
      AXS,
    } = await deploymentManager.getContracts();

    const usdcAssetConfig = {
      asset: USDC.address,
      priceFeed: newPriceFeedUSDCAddress,
      decimals: 6,
      borrowCollateralFactor: exp(0.50, 18),
      liquidateCollateralFactor: exp(0.80, 18),
      liquidationFactor: exp(0.80, 18),
      supplyCap: 0,
    };

    const wethAssetConfig = {
      asset: WETH.address,
      priceFeed: newPriceFeedWETHAddress,
      decimals: 18,
      borrowCollateralFactor: exp(0.50, 18),
      liquidateCollateralFactor: exp(0.80, 18),
      liquidationFactor: exp(0.80, 18),
      supplyCap: 0,
    };  

    const axsAssetConfig = {
      asset: AXS.address,
      priceFeed: newPriceFeedAXSAddress,
      decimals: 18,
      borrowCollateralFactor: exp(0.50, 18),
      liquidateCollateralFactor: exp(0.78, 18),
      liquidationFactor: exp(0.75, 18),
      supplyCap: 0,
    };

    // 1. WRON
    const WRONPriceFeedFromComet = await comet.baseTokenPriceFeed();
    const WRONPriceFeedFromConfigurator = (
      await configurator.getConfiguration(comet.address)
    ).baseTokenPriceFeed;

    expect(WRONPriceFeedFromComet).to.eq(newPriceFeedWRONAddress);
    expect(WRONPriceFeedFromConfigurator).to.eq(newPriceFeedWRONAddress);
    expect(await comet.getPrice(newPriceFeedWRONAddress)).to.be.closeTo(await comet.getPrice(oldWRONPriceFeed), 1e6);

    // 2. USDC
    const USDCIndexInComet = await configurator.getAssetIndex(
      comet.address,
      USDC.address
    );
    const USDCInCometInfo = await comet.getAssetInfoByAddress(USDC.address);
    const USDCInConfiguratorInfoComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[USDCIndexInComet];

    expect(usdcAssetConfig.asset).to.be.equal(USDCInCometInfo.asset);
    expect(usdcAssetConfig.priceFeed).to.eq(USDCInCometInfo.priceFeed);
    expect(exp(1, usdcAssetConfig.decimals)).to.be.equal(USDCInCometInfo.scale);
    expect(usdcAssetConfig.borrowCollateralFactor).to.be.equal(USDCInCometInfo.borrowCollateralFactor);
    expect(usdcAssetConfig.liquidateCollateralFactor).to.be.equal(USDCInCometInfo.liquidateCollateralFactor);
    expect(usdcAssetConfig.liquidationFactor).to.be.equal(USDCInCometInfo.liquidationFactor);
    expect(usdcAssetConfig.supplyCap).to.be.equal(USDCInCometInfo.supplyCap);

    expect(usdcAssetConfig.asset).to.be.equal(USDCInConfiguratorInfoComet.asset);
    expect(usdcAssetConfig.priceFeed).to.eq(USDCInConfiguratorInfoComet.priceFeed);
    expect(usdcAssetConfig.decimals).to.be.equal(USDCInConfiguratorInfoComet.decimals);
    expect(usdcAssetConfig.borrowCollateralFactor).to.be.equal(USDCInConfiguratorInfoComet.borrowCollateralFactor);
    expect(usdcAssetConfig.liquidateCollateralFactor).to.be.equal(USDCInConfiguratorInfoComet.liquidateCollateralFactor);
    expect(usdcAssetConfig.liquidationFactor).to.be.equal(USDCInConfiguratorInfoComet.liquidationFactor);
    expect(usdcAssetConfig.supplyCap).to.be.equal(USDCInConfiguratorInfoComet.supplyCap);

    expect(await comet.getPrice(newPriceFeedUSDCAddress)).to.be.closeTo(await comet.getPrice(oldUSDCPriceFeed), 1e6);

    // 3. WETH
    const WETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WETH.address
    );
    const WETHInCometInfo = await comet.getAssetInfoByAddress(WETH.address);
    const WETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[WETHIndexInComet];

    expect(wethAssetConfig.asset).to.be.equal(WETHInCometInfo.asset);
    expect(wethAssetConfig.priceFeed).to.eq(WETHInCometInfo.priceFeed);
    expect(exp(1, wethAssetConfig.decimals)).to.be.equal(WETHInCometInfo.scale);
    expect(wethAssetConfig.borrowCollateralFactor).to.be.equal(WETHInCometInfo.borrowCollateralFactor);
    expect(wethAssetConfig.liquidateCollateralFactor).to.be.equal(WETHInCometInfo.liquidateCollateralFactor);
    expect(wethAssetConfig.liquidationFactor).to.be.equal(WETHInCometInfo.liquidationFactor);
    expect(wethAssetConfig.supplyCap).to.be.equal(WETHInCometInfo.supplyCap);

    expect(wethAssetConfig.asset).to.be.equal(WETHInConfiguratorInfoWETHComet.asset);
    expect(wethAssetConfig.priceFeed).to.eq(WETHInConfiguratorInfoWETHComet.priceFeed);
    expect(wethAssetConfig.decimals).to.be.equal(WETHInConfiguratorInfoWETHComet.decimals);
    expect(wethAssetConfig.borrowCollateralFactor).to.be.equal(WETHInConfiguratorInfoWETHComet.borrowCollateralFactor);
    expect(wethAssetConfig.liquidateCollateralFactor).to.be.equal(WETHInConfiguratorInfoWETHComet.liquidateCollateralFactor);
    expect(wethAssetConfig.liquidationFactor).to.be.equal(WETHInConfiguratorInfoWETHComet.liquidationFactor);
    expect(wethAssetConfig.supplyCap).to.be.equal(WETHInConfiguratorInfoWETHComet.supplyCap);

    expect(await comet.getPrice(newPriceFeedWETHAddress)).to.be.closeTo(await comet.getPrice(oldWETHPriceFeed), 20e8); // $20

    // 4. AXS
    const AXSIndexInComet = await configurator.getAssetIndex(
      comet.address,
      AXS.address
    );
    const AXSInCometInfo = await comet.getAssetInfoByAddress(AXS.address);
    const AXSInConfiguratorInfoAXSComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[AXSIndexInComet];

    expect(axsAssetConfig.asset).to.be.equal(AXSInCometInfo.asset);
    expect(axsAssetConfig.priceFeed).to.eq(AXSInCometInfo.priceFeed);
    expect(exp(1, axsAssetConfig.decimals)).to.be.equal(AXSInCometInfo.scale);
    expect(axsAssetConfig.borrowCollateralFactor).to.be.equal(AXSInCometInfo.borrowCollateralFactor);
    expect(axsAssetConfig.liquidateCollateralFactor).to.be.equal(AXSInCometInfo.liquidateCollateralFactor);
    expect(axsAssetConfig.liquidationFactor).to.be.equal(AXSInCometInfo.liquidationFactor);
    expect(axsAssetConfig.supplyCap).to.be.equal(AXSInCometInfo.supplyCap);

    expect(axsAssetConfig.asset).to.be.equal(AXSInConfiguratorInfoAXSComet.asset);
    expect(axsAssetConfig.priceFeed).to.eq(AXSInConfiguratorInfoAXSComet.priceFeed);
    expect(axsAssetConfig.decimals).to.be.equal(AXSInConfiguratorInfoAXSComet.decimals);
    expect(axsAssetConfig.borrowCollateralFactor).to.be.equal(AXSInConfiguratorInfoAXSComet.borrowCollateralFactor);
    expect(axsAssetConfig.liquidateCollateralFactor).to.be.equal(AXSInConfiguratorInfoAXSComet.liquidateCollateralFactor);
    expect(axsAssetConfig.liquidationFactor).to.be.equal(AXSInConfiguratorInfoAXSComet.liquidationFactor);
    expect(axsAssetConfig.supplyCap).to.be.equal(AXSInConfiguratorInfoAXSComet.supplyCap);

    expect(await comet.getPrice(newPriceFeedAXSAddress)).to.be.closeTo(await comet.getPrice(oldAXSPriceFeed), 1e7); // $0.1

    const newConfig = {
      borrowRateBase: exp(0.025, 18),
      borrowRateSlopeLow: exp(0.017647, 18),
      borrowKink: exp(0.85, 18),
      borrowRateSlopeHigh: exp(0.732667, 18),
      supplyRateBase: 0n,
      supplyRateSlopeLow: exp(0.02, 18),
      supplyKink: exp(0.85, 18),
      supplyRateSlopeHigh: exp(0.868012, 18),
    };

    const borrowPerSecondInterestRateBase = await comet.borrowPerSecondInterestRateBase();
    expect(borrowPerSecondInterestRateBase).to.be.equal(
      newConfig.borrowRateBase / (86400n * 365n)
    );

    const borrowPerSecondInterestRateSlopeLow = await comet.borrowPerSecondInterestRateSlopeLow();
    expect(borrowPerSecondInterestRateSlopeLow).to.be.equal(
      newConfig.borrowRateSlopeLow / (86400n * 365n)
    );

    const borrowKink = await comet.borrowKink();
    expect(borrowKink).to.be.equal(newConfig.borrowKink);

    const borrowPerSecondInterestRateSlopeHigh = await comet.borrowPerSecondInterestRateSlopeHigh();
    expect(borrowPerSecondInterestRateSlopeHigh).to.be.equal(
      newConfig.borrowRateSlopeHigh / (86400n * 365n)
    );

    const supplyPerSecondInterestRateBase = await comet.supplyPerSecondInterestRateBase();
    expect(supplyPerSecondInterestRateBase).to.be.equal(
      newConfig.supplyRateBase / (86400n * 365n)
    );

    const supplyPerSecondInterestRateSlopeLow = await comet.supplyPerSecondInterestRateSlopeLow();
    expect(supplyPerSecondInterestRateSlopeLow).to.be.equal(
      newConfig.supplyRateSlopeLow / (86400n * 365n)
    );

    const supplyKink = await comet.supplyKink();
    expect(supplyKink).to.be.equal(newConfig.supplyKink);

    const supplyPerSecondInterestRateSlopeHigh = await comet.supplyPerSecondInterestRateSlopeHigh();
    expect(supplyPerSecondInterestRateSlopeHigh).to.be.equal(
      newConfig.supplyRateSlopeHigh / (86400n * 365n)
    );
  },
});
