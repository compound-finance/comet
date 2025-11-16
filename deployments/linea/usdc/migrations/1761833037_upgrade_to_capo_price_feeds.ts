import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal, exp } from '../../../../src/deploy';
import { utils, Contract, constants } from 'ethers';
import { AggregatorV3Interface, IRateProvider } from '../../../../build/types';

const WETH_COMET = '0x60F2058379716A64a7A5d29219397e79bC552194';

const ETH_USD_PRICE_FEED = '0x3c6Cd9Cc7c7a4c2Cf5a82734CD249D7D593354dA';

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

let newWstETHToUSDPriceFeed: string;
let oldWstETHToUSDPriceFeed: string;

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

    const rateProviderWstEthToETH = await deploymentManager.existing('wstEth:_rateProvider', WSTETH_STETH_PRICE_FEED_ADDRESS, 'linea', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWstEthToETH] = await rateProviderWstEthToETH.latestRoundData({blockTag: blockToFetch});
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
          snapshotRatio:  currentRatioWstEthToETH,
          snapshotTimestamp: blockToFetchTimestamp,
          maxYearlyRatioGrowthPercent: exp(0.0404, 4)
        }
      ],
      true
    );

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
      wstEthToUSDCapoPriceFeedAddress: wstEthToUSDCapoPriceFeed.address,
      wstEthToETHCapoPriceFeedAddress: wstEthToETHCapoPriceFeed.address,
      wrsEthCapoPriceFeedAddress: wrsEthCapoPriceFeed.address,
      weEthCapoPriceFeedAddress: weEthCapoPriceFeed.address,
      ezEthCapoPriceFeedAddress: ezEthCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager, {
    wstEthToUSDCapoPriceFeedAddress,
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

    newWstETHToUSDPriceFeed = wstEthToUSDCapoPriceFeedAddress;
    newWstETHToETHPriceFeed = wstEthToETHCapoPriceFeedAddress;
    newEzETHToETHPriceFeed = ezEthCapoPriceFeedAddress;
    newWrsETHToETHPriceFeed = wrsEthCapoPriceFeedAddress;
    newWeETHToETHPriceFeed = weEthCapoPriceFeedAddress;

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

    const deployAndUpgradeToCalldataWETH = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, WETH_COMET]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          cometAdmin.address,
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          cometAdmin.address,
        ],
        [0, 0, 0, 0, 0, 0, 0],
        [
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          updateWstEthPriceFeedCalldataUSDC,
          deployAndUpgradeToCalldataUSDC,
          updateWstEthPriceFeedCalldataWETH,
          updateEzEthPriceFeedCalldataWETH,
          updateWrsEthPriceFeedCalldataWETH,
          updateWeEthPriceFeedCalldataWETH,
          deployAndUpgradeToCalldataWETH,
        ],
      ]
    );

    [,, oldWstETHToUSDPriceFeed ] = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);

    const cometWETH = new Contract(
      WETH_COMET,
      [
        'function getAssetInfoByAddress(address asset) view returns (tuple(uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))',
      ],
      await deploymentManager.getSigner()
    );

    [,, oldWstETHToETHPriceFeed ] = await cometWETH.getAssetInfoByAddress(WSTETH_ADDRESS);
    [,, oldEzETHToETHPriceFeed ] = await cometWETH.getAssetInfoByAddress(EZETH_ADDRESS);
    [,, oldWrsETHToETHPriceFeed ] = await cometWETH.getAssetInfoByAddress(WRSETH_ADDRESS);
    [,, oldWeETHToETHPriceFeed ] = await cometWETH.getAssetInfoByAddress(WEETH_ADDRESS);

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

    const description = `# Update price feeds in cUSDCv3 and cWETHv3 on Linea with CAPO implementation.

## Proposal summary

This proposal updates existing price feeds for wstETH on the USDC and WETH markets and ezETH, wrsETH, and weETH on the WETH market on Linea.

### CAPO summary

CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes. wstETH, ezETH, wrsETH, and weETH price feeds are updated to their CAPO implementations.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1061) and [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245).

### CAPO audit

CAPO has been audited by [OpenZeppelin](https://www.comp.xyz/t/capo-price-feed-audit/6631, as well as the LST / LRT implementation [here](https://www.comp.xyz/t/capo-lst-lrt-audit/7118).

## Proposal actions

The first action updates wstETH, ezETH, wrsETH, and weETH price feeds to the CAPO implementation. This sends the encoded 'updateAssetPriceFeed' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Linea.
`;

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

    // wstETH in cUSDCv3
    const wstETHIndexInComet = await configurator.getAssetIndex(comet.address, WSTETH_ADDRESS);
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    const wstETHInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[wstETHIndexInComet];

    expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHToUSDPriceFeed);
    expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHToUSDPriceFeed);
    expect(await comet.getPrice(newWstETHToUSDPriceFeed)).to.be.closeTo(await comet.getPrice(oldWstETHToUSDPriceFeed), 10e8);

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
    expect(await cometWETH.getPrice(newWrsETHToETHPriceFeed)).to.be.closeTo(await cometWETH.getPrice(oldWrsETHToETHPriceFeed), 1e6);

    // weETH in cWETHv3
    const weETHIndexInCometWETH = await configurator.getAssetIndex(cometWETH.address, WEETH_ADDRESS);
    const weETHInCometInfoWETH = await cometWETH.getAssetInfoByAddress(WEETH_ADDRESS);
    const weETHInConfiguratorInfoWETHCometWETH = (await configurator.getConfiguration(cometWETH.address)).assetConfigs[weETHIndexInCometWETH];

    expect(weETHInCometInfoWETH.priceFeed).to.eq(newWeETHToETHPriceFeed);
    expect(weETHInConfiguratorInfoWETHCometWETH.priceFeed).to.eq(newWeETHToETHPriceFeed);
    expect(await cometWETH.getPrice(newWeETHToETHPriceFeed)).to.equal(await cometWETH.getPrice(oldWeETHToETHPriceFeed));
  },
});
