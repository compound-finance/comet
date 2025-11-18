import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';
import { Numeric } from '../../../../test/helpers';
import { AggregatorV3Interface } from '../../../../build/types';

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
  return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

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
      wstEthToETHCapoPriceFeedAddress: wstEthToETHCapoPriceFeed.address,
      wrsEthCapoPriceFeedAddress: wrsEthCapoPriceFeed.address,
      weEthCapoPriceFeedAddress: weEthCapoPriceFeed.address,
      ezEthCapoPriceFeedAddress: ezEthCapoPriceFeed.address,
      rEthCapoPriceFeedAddress: rEthCapoPriceFeed.address,
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager, {
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

    newWstETHToETHPriceFeed = wstEthToETHCapoPriceFeedAddress;
    newEzETHToETHPriceFeed = ezEthCapoPriceFeedAddress;
    newWrsETHToETHPriceFeed = wrsEthCapoPriceFeedAddress;
    newWeETHToETHPriceFeed = weEthCapoPriceFeedAddress;
    newRETHToETHPriceFeed = rEthCapoPriceFeedAddress;

    const updateWstEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WSTETH_ADDRESS,
        wstEthToETHCapoPriceFeedAddress
      )
    );

    const updateEzEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        EZETH_ADDRESS,
        ezEthCapoPriceFeedAddress
      )
    );

    const updateWrsEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WRSETH_ADDRESS,
        wrsEthCapoPriceFeedAddress
      )
    );

    const updateWeEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WEETH_ADDRESS,
        weEthCapoPriceFeedAddress
      )
    );

    const updateRETHPriceFeedCalldataWETH = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        RETH_ADDRESS,
        rEthCapoPriceFeedAddress
      )
    );

    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
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
          cometAdmin.address,
        ],
        [0, 0, 0, 0, 0, 0],
        [
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          updateWstEthPriceFeedCalldata,
          updateEzEthPriceFeedCalldata,
          updateWrsEthPriceFeedCalldata,
          updateWeEthPriceFeedCalldata,
          updateRETHPriceFeedCalldataWETH,
          deployAndUpgradeToCalldata,
        ],
      ]
    );

    [,, oldWstETHToETHPriceFeed ] = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    [,, oldEzETHToETHPriceFeed ] = await comet.getAssetInfoByAddress(EZETH_ADDRESS);
    [,, oldWrsETHToETHPriceFeed ] = await comet.getAssetInfoByAddress(WRSETH_ADDRESS);
    [,, oldWeETHToETHPriceFeed ] = await comet.getAssetInfoByAddress(WEETH_ADDRESS);
    [,, oldRETHToETHPriceFeed ] = await comet.getAssetInfoByAddress(RETH_ADDRESS);

    const mainnetActions = [
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },
    ];

    const description = `DESCRIPTION`;

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

    // wstETH
    const wstETHIndexInComet = await configurator.getAssetIndex(comet.address, WSTETH_ADDRESS);
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    const wstETHInConfiguratorInfoComet = (await configurator.getConfiguration(comet.address)).assetConfigs[wstETHIndexInComet];

    expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHToETHPriceFeed);
    expect(wstETHInConfiguratorInfoComet.priceFeed).to.eq(newWstETHToETHPriceFeed);
    expect(await comet.getPrice(newWstETHToETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldWstETHToETHPriceFeed), 1e6);

    // ezETH
    const ezETHIndexInComet = await configurator.getAssetIndex(comet.address, EZETH_ADDRESS);
    const ezETHInCometInfo = await comet.getAssetInfoByAddress(EZETH_ADDRESS);
    const ezETHInConfiguratorInfoComet = (await configurator.getConfiguration(comet.address)).assetConfigs[ezETHIndexInComet];

    expect(ezETHInCometInfo.priceFeed).to.eq(newEzETHToETHPriceFeed);
    expect(ezETHInConfiguratorInfoComet.priceFeed).to.eq(newEzETHToETHPriceFeed);
    expect(await comet.getPrice(newEzETHToETHPriceFeed)).to.equal(await comet.getPrice(oldEzETHToETHPriceFeed));

    // wrsETH
    const wrsETHIndexInComet = await configurator.getAssetIndex(comet.address, WRSETH_ADDRESS);
    const wrsETHInCometInfo = await comet.getAssetInfoByAddress(WRSETH_ADDRESS);
    const wrsETHInConfiguratorInfoComet = (await configurator.getConfiguration(comet.address)).assetConfigs[wrsETHIndexInComet];

    expect(wrsETHInCometInfo.priceFeed).to.eq(newWrsETHToETHPriceFeed);
    expect(wrsETHInConfiguratorInfoComet.priceFeed).to.eq(newWrsETHToETHPriceFeed);
    expect(await comet.getPrice(newWrsETHToETHPriceFeed)).to.equal(await comet.getPrice(oldWrsETHToETHPriceFeed));

    // weETH
    const weETHIndexInComet = await configurator.getAssetIndex(comet.address, WEETH_ADDRESS);
    const weETHInCometInfo = await comet.getAssetInfoByAddress(WEETH_ADDRESS);
    const weETHInConfiguratorInfoComet = (await configurator.getConfiguration(comet.address)).assetConfigs[weETHIndexInComet];

    expect(weETHInCometInfo.priceFeed).to.eq(newWeETHToETHPriceFeed);
    expect(weETHInConfiguratorInfoComet.priceFeed).to.eq(newWeETHToETHPriceFeed);
    expect(await comet.getPrice(newWeETHToETHPriceFeed)).to.equal(await comet.getPrice(oldWeETHToETHPriceFeed));

    // rETH in cWETHv3
    const rETHIndexInCometWETH = await configurator.getAssetIndex(comet.address, RETH_ADDRESS);
    const rETHInCometInfoWETH = await comet.getAssetInfoByAddress(RETH_ADDRESS);
    const rETHInConfiguratorInfoWETHCometWETH = (await configurator.getConfiguration(comet.address)).assetConfigs[rETHIndexInCometWETH];

    expect(rETHInCometInfoWETH.priceFeed).to.eq(newRETHToETHPriceFeed);
    expect(rETHInConfiguratorInfoWETHCometWETH.priceFeed).to.eq(newRETHToETHPriceFeed);
    expect(await comet.getPrice(newRETHToETHPriceFeed)).to.equal(await comet.getPrice(oldRETHToETHPriceFeed));
  },
});
