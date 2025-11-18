import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal, exp } from '../../../../src/deploy';
import { utils, Contract } from 'ethers';
import { AggregatorV3Interface } from '../../../../build/types';

const USDT_COMET = '0x995E394b8B2437aC8Ce61Ee0bC610D617962B214';
const WETH_COMET = '0xE36A30D249f7761327fd973001A32010b521b6Fd';
const ETH_USD_PRICE_FEED = '0x13e3Ee699D1909E989722E753853AE30b17e08c5';

const WSTETH_ADDRESS = '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb';
const WSTETH_STETH_PRICE_FEED_ADDRESS = '0xe59EBa0D492cA53C6f46015EEa00517F2707dc77';

const EZETH_ADDRESS = '0x2416092f143378750bb29b79eD961ab195CcEea5';
const EZETH_ETH_RATE_PROVIDER = '0xFAD40C0e2BeF93c6a822015863045CAAeAAde4d3';

const WRSETH_ADDRESS ='0x87eEE96D50Fb761AD85B1c982d28A042169d61b1';
const WRSETH_ETH_RATE_PROVIDER = '0x73b8BE3b653c5896BC34fC87cEBC8AcF4Fb7A545';

const WEETH_ADDRESS = '0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF';
const WEETH_TO_ETH_RATE_PROVIDER = '0x72EC6bF88effEd88290C66DCF1bE2321d80502f5';

const RETH_ADDRESS = '0x9Bcef72be871e61ED4fBbc7630889beE758eb81D';
const RETH_ETH_PRICE_FEED_ADDRESS = '0x22F3727be377781d1579B7C9222382b21c9d1a8f';

const FEED_DECIMALS = 8;
const blockToFetch = 142800000;

let newWstETHToUSDPriceFeed: string;
let oldWstETHToUSDPriceFeedUSDC: string;
let oldWstETHToUSDPriceFeedUSDT: string;

let newWstETHToETHPriceFeed: string;
let newEzETHToETHPriceFeed: string;
let newWrsETHToETHPriceFeed: string;
let newWeETHToETHPriceFeed: string;
let newRETHToETHPriceFeed: string;

let oldWstETHToETHPriceFeed: string;
let oldEzETHToETHPriceFeed: string;
let oldWrsETHToETHPriceFeed: string;
let oldWeETHToETHPriceFeed: string;
let oldRETHToETHPriceFeed: string;

export default migration('1761567671_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { timelock } = await deploymentManager.getContracts();
    const blockToFetchTimestamp = (await deploymentManager.hre.ethers.provider.getBlock(blockToFetch))!.timestamp;
    const constantPriceFeed = await deploymentManager.fromDep('WETH:priceFeed', 'optimism', 'weth');

    const rateProviderWstEthToUSD = await deploymentManager.existing('wstEth:_rateProvider', WSTETH_STETH_PRICE_FEED_ADDRESS, 'optimism', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWstEthToUSD] = await rateProviderWstEthToUSD.latestRoundData({blockTag: blockToFetch});
    const wstEthToUSDCapoPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        ETH_USD_PRICE_FEED,
        WSTETH_STETH_PRICE_FEED_ADDRESS, // wstETH / ETH price feed
        'wstETH / USD CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio:  currentRatioWstEthToUSD,
          snapshotTimestamp: blockToFetchTimestamp,
          maxYearlyRatioGrowthPercent: exp(0.0404, 4)
        }
      ],
      true
    );

    const rateProviderWstEthToETH = await deploymentManager.existing('wstEth:_rateProvider', WSTETH_STETH_PRICE_FEED_ADDRESS, 'optimism', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWstEthToETH] = await rateProviderWstEthToETH.latestRoundData({blockTag: blockToFetch});
    const wstEthToETHCapoPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        constantPriceFeed.address,
        WSTETH_STETH_PRICE_FEED_ADDRESS,
        'wstETH / ETH CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioWstEthToETH,
          snapshotTimestamp: blockToFetchTimestamp,
          maxYearlyRatioGrowthPercent: exp(0.0404, 4)
        }
      ],
      true
    );

    const rateProviderEzEth = await deploymentManager.existing('ezETH:_priceFeed', EZETH_ETH_RATE_PROVIDER, 'optimism', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [,currentRatioEzEth] = await rateProviderEzEth.latestRoundData({blockTag: blockToFetch});
    const ezEthCapoPriceFeed = await deploymentManager.deploy(
      'ezETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        constantPriceFeed.address,
        rateProviderEzEth.address,
        'ezETH / ETH CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioEzEth,
          snapshotTimestamp: blockToFetchTimestamp,
          maxYearlyRatioGrowthPercent: exp(0.0707, 4)
        }
      ],
      true
    );

    const wrsEthRateProvider = await deploymentManager.existing('wrsETH:_priceFeed', WRSETH_ETH_RATE_PROVIDER, 'optimism', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWrsEth] = await wrsEthRateProvider.latestRoundData({blockTag: blockToFetch});
    const wrsEthCapoPriceFeed = await deploymentManager.deploy(
      'wrsETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        constantPriceFeed.address,
        wrsEthRateProvider.address,
        'wrsETH / ETH CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioWrsEth,
          snapshotTimestamp: blockToFetchTimestamp,
          maxYearlyRatioGrowthPercent: exp(0.0554, 4)
        }
      ],
      true
    );

    const weEthRateProvider = await deploymentManager.existing('weETH:_priceFeed', WEETH_TO_ETH_RATE_PROVIDER, 'optimism', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWeEth] = await weEthRateProvider.latestRoundData({blockTag: blockToFetch});
    const weEthCapoPriceFeed = await deploymentManager.deploy(
      'weETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        constantPriceFeed.address,
        weEthRateProvider.address,
        'weETH / ETH CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioWeEth,
          snapshotTimestamp: blockToFetchTimestamp,
          maxYearlyRatioGrowthPercent: exp(0.0323, 4)
        }
      ],
      true
    );

    const rateProviderRETH = await deploymentManager.existing('rETH:_priceFeed', RETH_ETH_PRICE_FEED_ADDRESS, 'optimism', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioRETH] = await rateProviderRETH .latestRoundData({blockTag: blockToFetch});
    const rEthCapoPriceFeed = await deploymentManager.deploy(
      'rETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        constantPriceFeed.address,
        rateProviderRETH.address,
        'rETH / ETH CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioRETH,
          snapshotTimestamp: blockToFetchTimestamp,
          maxYearlyRatioGrowthPercent: exp(0.029, 4)
        }
      ],
      true
    );

    return {
      wstEthToUSDCapoPriceFeedAddress: wstEthToUSDCapoPriceFeed.address,
      wstEthToETHCapoPriceFeedAddress: wstEthToETHCapoPriceFeed.address,
      wrsEthCapoPriceFeedAddress: wrsEthCapoPriceFeed.address,
      weEthCapoPriceFeedAddress: weEthCapoPriceFeed.address,
      ezEthCapoPriceFeedAddress: ezEthCapoPriceFeed.address,
      rEthCapoPriceFeedAddress: rEthCapoPriceFeed.address,
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager, {
    wstEthToUSDCapoPriceFeedAddress,
    wstEthToETHCapoPriceFeedAddress,
    wrsEthCapoPriceFeedAddress,
    weEthCapoPriceFeedAddress,
    ezEthCapoPriceFeedAddress,
    rEthCapoPriceFeedAddress,
  }) {
    const trace = deploymentManager.tracer();

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const { 
      governor, 
      opL1CrossDomainMessenger 
    } = await govDeploymentManager.getContracts();

    newWstETHToUSDPriceFeed = wstEthToUSDCapoPriceFeedAddress;
    newWstETHToETHPriceFeed = wstEthToETHCapoPriceFeedAddress;
    newEzETHToETHPriceFeed = ezEthCapoPriceFeedAddress;
    newWrsETHToETHPriceFeed = wrsEthCapoPriceFeedAddress;
    newWeETHToETHPriceFeed = weEthCapoPriceFeedAddress;
    newRETHToETHPriceFeed = rEthCapoPriceFeedAddress;

    const updateWstEthPriceFeedCalldataUSDC = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WSTETH_ADDRESS,
        wstEthToUSDCapoPriceFeedAddress
      )
    );

    const deployAndUpgradeToCalldataUSDC = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const updateWstEthPriceFeedCalldataUSDT = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        USDT_COMET,
        WSTETH_ADDRESS,
        wstEthToUSDCapoPriceFeedAddress
      )
    );

    const updateWstEthPriceFeedCalldataWETH = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        WETH_COMET,
        WSTETH_ADDRESS,
        wstEthToETHCapoPriceFeedAddress
      )
    );

    const updateEzEthPriceFeedCalldataWETH = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        WETH_COMET,
        EZETH_ADDRESS,
        ezEthCapoPriceFeedAddress
      )
    );

    const updateWrsEthPriceFeedCalldataWETH = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        WETH_COMET,
        WRSETH_ADDRESS,
        wrsEthCapoPriceFeedAddress
      )
    );

    const updateWeEthPriceFeedCalldataWETH = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        WETH_COMET,
        WEETH_ADDRESS,
        weEthCapoPriceFeedAddress
      )
    );

    const updateRETHPriceFeedCalldataWETH = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        WETH_COMET,
        RETH_ADDRESS,
        rEthCapoPriceFeedAddress
      )
    );

    const deployAndUpgradeToCalldataWETH = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, WETH_COMET]
    );

    const deployAndUpgradeToCalldataUSDT = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, USDT_COMET]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          cometAdmin.address,
          configurator.address,
          cometAdmin.address,
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          cometAdmin.address,
        ],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          updateWstEthPriceFeedCalldataUSDC,
          deployAndUpgradeToCalldataUSDC,
          updateWstEthPriceFeedCalldataUSDT,
          deployAndUpgradeToCalldataUSDT,
          updateWstEthPriceFeedCalldataWETH,
          updateEzEthPriceFeedCalldataWETH,
          updateWrsEthPriceFeedCalldataWETH,
          updateWeEthPriceFeedCalldataWETH,
          updateRETHPriceFeedCalldataWETH,
          deployAndUpgradeToCalldataWETH,
        ],
      ]
    );

    [,, oldWstETHToUSDPriceFeedUSDC ] = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);

    const cometUSDT = new Contract(
      USDT_COMET,
      [
        'function getAssetInfoByAddress(address asset) view returns (tuple(uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))',
      ],
      await deploymentManager.getSigner()
    );

    const cometWETH = new Contract(
      WETH_COMET,
      [
        'function getAssetInfoByAddress(address asset) view returns (tuple(uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))',
      ],
      await deploymentManager.getSigner()
    );

    [,, oldWstETHToUSDPriceFeedUSDT ] = await cometUSDT.getAssetInfoByAddress(WSTETH_ADDRESS);
    [,, oldWstETHToETHPriceFeed ] = await cometWETH.getAssetInfoByAddress(WSTETH_ADDRESS);
    [,, oldEzETHToETHPriceFeed ] = await cometWETH.getAssetInfoByAddress(EZETH_ADDRESS);
    [,, oldWrsETHToETHPriceFeed ] = await cometWETH.getAssetInfoByAddress(WRSETH_ADDRESS);
    [,, oldWeETHToETHPriceFeed ] = await cometWETH.getAssetInfoByAddress(WEETH_ADDRESS);
    [,, oldRETHToETHPriceFeed ] = await cometWETH.getAssetInfoByAddress(RETH_ADDRESS);

    const mainnetActions = [
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },
    ];

    const description = `# Update price feeds in cUSDCv3, cUSDTv3 and cWETHv3 on Optimism with CAPO implementation.

## Proposal summary

This proposal updates existing price feeds for wstETH on the USDC, USDT and WETH markets and ezETH, wrsETH, weETH, and rETH on the WETH market on Optimism.

### CAPO summary

CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes. wstETH, ezETH, wrsETH, weETH, and rETH price feeds are updated to their CAPO implementations.
Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1062) and [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245).

### CAPO audit

CAPO has been audited by [OpenZeppelin](https://www.comp.xyz/t/capo-price-feed-audit/6631, as well as the LST / LRT implementation [here](https://www.comp.xyz/t/capo-lst-lrt-audit/7118).

## Proposal actions

The first action updates wstETH, ezETH, wrsETH, weETH, and rETH price feeds to the CAPO implementation. This sends the encoded 'updateAssetPriceFeed' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Optimism.
`;

    const signer = await govDeploymentManager.getSigner();

    const txn = await govDeploymentManager.retry(async () =>
      trace(
        await governor.connect(signer).propose(...(await proposal(mainnetActions, description)))
      ), 1, 300_000
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
    const { comet, configurator } = await deploymentManager.getContracts();

    // wstETH in cUSDCv3
    const wstETHIndexInComet = await configurator.getAssetIndex(comet.address, WSTETH_ADDRESS);
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    const wstETHInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[wstETHIndexInComet];

    expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHToUSDPriceFeed);
    expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHToUSDPriceFeed);
    expect(await comet.getPrice(newWstETHToUSDPriceFeed)).to.be.closeTo(await comet.getPrice(oldWstETHToUSDPriceFeedUSDC), 10e8);

    // wstETH in cUSDTv3
    const cometUSDT = new Contract(
      USDT_COMET,
      [
        'function getAssetInfoByAddress(address asset) view returns (tuple(uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))',
        'function getPrice(address asset) view returns (uint256)',
      ],
      await deploymentManager.getSigner()
    );

    const wstETHIndexInCometUSDT = await configurator.getAssetIndex(cometUSDT.address, WSTETH_ADDRESS);
    const wstETHInCometInfoUSDT = await cometUSDT.getAssetInfoByAddress(WSTETH_ADDRESS);
    const wstETHInConfiguratorInfoWETHCometUSDT = (await configurator.getConfiguration(cometUSDT.address)).assetConfigs[wstETHIndexInCometUSDT];

    expect(wstETHInCometInfoUSDT.priceFeed).to.eq(newWstETHToUSDPriceFeed);
    expect(wstETHInConfiguratorInfoWETHCometUSDT.priceFeed).to.eq(newWstETHToUSDPriceFeed);
    expect(await cometUSDT.getPrice(newWstETHToUSDPriceFeed)).to.be.closeTo(await cometUSDT.getPrice(oldWstETHToUSDPriceFeedUSDT), 10e8);

    // wstETH in cWETHv3
    const cometWETH = new Contract(
      WETH_COMET,
      [
        'function getAssetInfoByAddress(address asset) view returns (tuple(uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))',
        'function getPrice(address asset) view returns (uint256)',
      ],
      await deploymentManager.getSigner()
    );
    const wstETHIndexInCometWETH = await configurator.getAssetIndex(cometWETH.address, WSTETH_ADDRESS);
    const wstETHInCometInfoWETH = await cometWETH.getAssetInfoByAddress(WSTETH_ADDRESS);
    const wstETHInConfiguratorInfoWETHCometWETH = (await configurator.getConfiguration(cometWETH.address)).assetConfigs[wstETHIndexInCometWETH];

    expect(wstETHInCometInfoWETH.priceFeed).to.eq(newWstETHToETHPriceFeed);
    expect(wstETHInConfiguratorInfoWETHCometWETH.priceFeed).to.eq(newWstETHToETHPriceFeed);
    expect(await cometWETH.getPrice(newWstETHToETHPriceFeed)).to.be.closeTo(await cometWETH.getPrice(oldWstETHToETHPriceFeed), 1e6);

    // ezETH in cWETHv3
    const ezETHIndexInCometWETH = await configurator.getAssetIndex(cometWETH.address, EZETH_ADDRESS);
    const ezETHInCometInfoWETH = await cometWETH.getAssetInfoByAddress(EZETH_ADDRESS);
    const ezETHInConfiguratorInfoWETHCometWETH = (await configurator.getConfiguration(cometWETH.address)).assetConfigs[ezETHIndexInCometWETH];

    expect(ezETHInCometInfoWETH.priceFeed).to.eq(newEzETHToETHPriceFeed);
    expect(ezETHInConfiguratorInfoWETHCometWETH.priceFeed).to.eq(newEzETHToETHPriceFeed);
    expect(await cometWETH.getPrice(newEzETHToETHPriceFeed)).to.equal(await cometWETH.getPrice(oldEzETHToETHPriceFeed));

    // wrsETH in cWETHv3
    const wrsETHIndexInCometWETH = await configurator.getAssetIndex(cometWETH.address, WRSETH_ADDRESS);
    const wrsETHInCometInfoWETH = await cometWETH.getAssetInfoByAddress(WRSETH_ADDRESS);
    const wrsETHInConfiguratorInfoWETHCometWETH = (await configurator.getConfiguration(cometWETH.address)).assetConfigs[wrsETHIndexInCometWETH];

    expect(wrsETHInCometInfoWETH.priceFeed).to.eq(newWrsETHToETHPriceFeed);
    expect(wrsETHInConfiguratorInfoWETHCometWETH.priceFeed).to.eq(newWrsETHToETHPriceFeed);
    expect(await cometWETH.getPrice(newWrsETHToETHPriceFeed)).to.equal(await cometWETH.getPrice(oldWrsETHToETHPriceFeed));

    // weETH in cWETHv3
    const weETHIndexInCometWETH = await configurator.getAssetIndex(cometWETH.address, WEETH_ADDRESS);
    const weETHInCometInfoWETH = await cometWETH.getAssetInfoByAddress(WEETH_ADDRESS);
    const weETHInConfiguratorInfoWETHCometWETH = (await configurator.getConfiguration(cometWETH.address)).assetConfigs[weETHIndexInCometWETH];

    expect(weETHInCometInfoWETH.priceFeed).to.eq(newWeETHToETHPriceFeed);
    expect(weETHInConfiguratorInfoWETHCometWETH.priceFeed).to.eq(newWeETHToETHPriceFeed);
    expect(await cometWETH.getPrice(newWeETHToETHPriceFeed)).to.equal(await cometWETH.getPrice(oldWeETHToETHPriceFeed));

    // rETH in cWETHv3
    const rETHIndexInCometWETH = await configurator.getAssetIndex(cometWETH.address, RETH_ADDRESS);
    const rETHInCometInfoWETH = await cometWETH.getAssetInfoByAddress(RETH_ADDRESS);
    const rETHInConfiguratorInfoWETHCometWETH = (await configurator.getConfiguration(cometWETH.address)).assetConfigs[rETHIndexInCometWETH];

    expect(rETHInCometInfoWETH.priceFeed).to.eq(newRETHToETHPriceFeed);
    expect(rETHInConfiguratorInfoWETHCometWETH.priceFeed).to.eq(newRETHToETHPriceFeed);
    expect(await cometWETH.getPrice(newRETHToETHPriceFeed)).to.equal(await cometWETH.getPrice(oldRETHToETHPriceFeed));
  },
});
