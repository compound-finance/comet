import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal, exp } from '../../../../src/deploy';
import { utils, constants } from 'ethers';
import { AggregatorV3Interface, IRateProvider } from '../../../../build/types';

const WSTETH_ADDRESS = '0xB5beDd42000b71FddE22D3eE8a79Bd49A568fC8F';
const WSTETH_STETH_PRICE_FEED_ADDRESS = '0x3C8A95F2264bB3b52156c766b738357008d87cB7';

const EZETH_ADDRESS = '0x2416092f143378750bb29b79eD961ab195CcEea5';
const EZETH_TO_ETH_PRICE_FEED_ADDRESS = '0xb71F79770BA599940F454c70e63d4DE0E8606731';

const WEETH_ADDRESS = '0x1Bf74C010E6320bab11e2e5A532b5AC15e0b8aA6';
const WEETH_TO_ETH_RATE_PROVIDER = '0x1FBc7d24654b10c71fd74d3730d9Df17836181EF';

const WRSETH_ADDRESS = '0xD2671165570f41BBB3B0097893300b6EB6101E6C';
const WRSETH_ETH_RATE_PROVIDER = '0x81E5c1483c6869e95A4f5B00B41181561278179F';

const FEED_DECIMALS = 8;
const RATE_DECIMALS = 18;
const blockToFetch = 25000000;

let newWstETHToETHPriceFeed: string;
let newEzETHToETHPriceFeed: string;
let newWrsETHToETHPriceFeed: string;
let newWeETHToETHPriceFeed: string;

let oldWstETHToETHPriceFeed: string;
let oldEzETHToETHPriceFeed: string;
let oldWrsETHToETHPriceFeed: string;
let oldWeETHToETHPriceFeed: string;

export default migration('1761833037_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { timelock } = await deploymentManager.getContracts();
    const blockToFetchTimestamp = (await deploymentManager.hre.ethers.provider.getBlock(blockToFetch))!.timestamp;
    const constantPriceFeed = await deploymentManager.fromDep('WETH:priceFeed', 'linea', 'weth');

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

    const rateProviderEzEth = await deploymentManager.existing('ezETH:_priceFeed', EZETH_TO_ETH_PRICE_FEED_ADDRESS, 'linea', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioEzEth] = await rateProviderEzEth.latestRoundData({blockTag: blockToFetch});
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

    const wrsEthRateProvider = await deploymentManager.existing('wrsETH:_priceFeed', WRSETH_ETH_RATE_PROVIDER, 'linea', 'contracts/capo/contracts/interfaces/IRateProvider.sol:IRateProvider') as IRateProvider;
    const currentRatioWrsEth = await wrsEthRateProvider.getRate({blockTag: blockToFetch});

    const wrsEthCapoPriceFeed = await deploymentManager.deploy(
      'wrsETH:priceFeed',
      'capo/contracts/RateBasedCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        constantPriceFeed.address,
        WRSETH_ETH_RATE_PROVIDER,
        constants.AddressZero,
        'wrsETH / ETH CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        RATE_DECIMALS,
        {
          snapshotRatio: currentRatioWrsEth,
          snapshotTimestamp: blockToFetchTimestamp,
          maxYearlyRatioGrowthPercent: exp(0.0554, 4) // 5.54%
        }
      ],
      true
    );

    const weEthRateProvider = await deploymentManager.existing('weETH:_priceFeed', WEETH_TO_ETH_RATE_PROVIDER, 'linea', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
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

    return {
      wstEthToETHCapoPriceFeedAddress: wstEthToETHCapoPriceFeed.address,
      wrsEthCapoPriceFeedAddress: wrsEthCapoPriceFeed.address,
      weEthCapoPriceFeedAddress: weEthCapoPriceFeed.address,
      ezEthCapoPriceFeedAddress: ezEthCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager, {
    wstEthToETHCapoPriceFeedAddress,
    wrsEthCapoPriceFeedAddress,
    weEthCapoPriceFeedAddress,
    ezEthCapoPriceFeedAddress
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
      lineaMessageService 
    } = await govDeploymentManager.getContracts();

    newWstETHToETHPriceFeed = wstEthToETHCapoPriceFeedAddress;
    newEzETHToETHPriceFeed = ezEthCapoPriceFeedAddress;
    newWrsETHToETHPriceFeed = wrsEthCapoPriceFeedAddress;
    newWeETHToETHPriceFeed = weEthCapoPriceFeedAddress;

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
          cometAdmin.address,
        ],
        [0, 0, 0, 0, 0],
        [
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
          deployAndUpgradeToCalldata,
        ],
      ]
    );

    [,, oldWstETHToETHPriceFeed ] = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    [,, oldEzETHToETHPriceFeed ] = await comet.getAssetInfoByAddress(EZETH_ADDRESS);
    [,, oldWrsETHToETHPriceFeed ] = await comet.getAssetInfoByAddress(WRSETH_ADDRESS);
    [,, oldWeETHToETHPriceFeed ] = await comet.getAssetInfoByAddress(WEETH_ADDRESS);

    const mainnetActions = [
      {
        contract: lineaMessageService,
        signature: 'sendMessage(address,uint256,bytes)',
        args: [
          bridgeReceiver.address,  // address to
          0,                       // uint256 value
          l2ProposalData           // bytes calldata data
        ],
        value: 0
      },
    ];

    const description = `DESCRIPTION`;

    const signer = await govDeploymentManager.getSigner();

    const txn = await govDeploymentManager.retry(async () =>
      trace(
        await governor.connect(signer).propose(...(await proposal(mainnetActions, description)))
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
    expect(await comet.getPrice(newWrsETHToETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldWrsETHToETHPriceFeed), 1e6);

    // weETH
    const weETHIndexInComet = await configurator.getAssetIndex(comet.address, WEETH_ADDRESS);
    const weETHInCometInfo = await comet.getAssetInfoByAddress(WEETH_ADDRESS);
    const weETHInConfiguratorInfoComet = (await configurator.getConfiguration(comet.address)).assetConfigs[weETHIndexInComet];

    expect(weETHInCometInfo.priceFeed).to.eq(newWeETHToETHPriceFeed);
    expect(weETHInConfiguratorInfoComet.priceFeed).to.eq(newWeETHToETHPriceFeed);
    expect(await comet.getPrice(newWeETHToETHPriceFeed)).to.equal(await comet.getPrice(oldWeETHToETHPriceFeed));
  },
});
