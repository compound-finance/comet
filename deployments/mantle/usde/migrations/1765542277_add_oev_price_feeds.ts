import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { ethers } from 'ethers';
import { AggregatorV3Interface } from '../../../../build/types';

const USDE_TO_USD_PRICE_FEED_ADDRESS = '0x081B37a465C0e91b36dCe3419B32c584dc854a17';
const METH_TO_ETH_PRICE_FEED_ADDRESS = '0x315eFAF7cC9DD5F27C2ebf520Fce3AbB192aB894';
const ETH_TO_USD_PRICE_FEED_ADDRESS = '0x973899ffcc6B3F7F3fECC0de777533C8981D5923';
const FBTC_TO_USD_PRICE_FEED_ADDRESS = '0xE9643e50476Be1cAB4624a6Ba976300CF747C3d9';

const FEED_DECIMALS = 8;
const blockToFetchFrom = 86000000;

let newPriceFeedUsde: string;
let newPriceFeedWeth: string;
let newPriceFeedMeth: string;
let newPriceFeedFbtc: string;

let oldPriceFeedUsde: string;
let oldPriceFeedWeth: string;
let oldPriceFeedMeth: string;
let oldPriceFeedFbtc: string;

export default migration('1765542277_add_ezeth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const { timelock } = await deploymentManager.getContracts();

    // 1. mEth
    const rateProviderMEth = await deploymentManager.existing('mETH:_rateProvider', METH_TO_ETH_PRICE_FEED_ADDRESS, 'mantle', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const timestamp = (await deploymentManager.hre.ethers.provider.getBlock(blockToFetchFrom))?.timestamp;
    const [, currentRatioMEth] = await rateProviderMEth.latestRoundData({ blockTag: blockToFetchFrom });

    const mEthCapoPriceFeed = await deploymentManager.deploy(
      'mETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        ETH_TO_USD_PRICE_FEED_ADDRESS,
        METH_TO_ETH_PRICE_FEED_ADDRESS,
        'mETH / USD CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioMEth,
          snapshotTimestamp: timestamp,
          maxYearlyRatioGrowthPercent: exp(0.0391, 4)
        }
      ],
      true
    );

    // 2. USDe
    const usdePriceFeed = await deploymentManager.deploy(
      'USDe:priceFeed',
      'pricefeeds/ScalingPriceFeedWithCustomDescription.sol',
      [
        USDE_TO_USD_PRICE_FEED_ADDRESS,   // USDe / USD price feed
        8,                                // decimals
        'USDe / USD price feed'           // description
      ],
      true
    );

    // 3. WETH
    const wethPriceFeed = await deploymentManager.deploy(
      'WETH:priceFeed',
      'pricefeeds/ScalingPriceFeedWithCustomDescription.sol',
      [
        ETH_TO_USD_PRICE_FEED_ADDRESS,   // ETH / USD price feed
        8,                               // decimals
        'WETH / USD price feed'          // description
      ],
      true
    );

    // 4. FBTC
    const fbtcPriceFeed = await deploymentManager.deploy(
      'FBTC:priceFeed',
      'pricefeeds/ScalingPriceFeedWithCustomDescription.sol',
      [
        FBTC_TO_USD_PRICE_FEED_ADDRESS,   // FBTC / USD price feed
        8,                                // decimals
        'FBTC / USD price feed'           // description
      ],
      true
    );

    return {
      usdePriceFeedAddress: usdePriceFeed.address,
      wethPriceFeedAddress: wethPriceFeed.address,
      methPriceFeedAddress: mEthCapoPriceFeed.address,
      fbtcPriceFeedAddress: fbtcPriceFeed.address
    };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    {
      usdePriceFeedAddress,
      wethPriceFeedAddress,
      methPriceFeedAddress,
      fbtcPriceFeedAddress
    }) => {
    const trace = deploymentManager.tracer();
    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      WETH,
      mETH,
      FBTC
    } = await deploymentManager.getContracts();

    const {
      mantleL1CrossDomainMessenger,
      governor
    } = await govDeploymentManager.getContracts();

    newPriceFeedUsde = usdePriceFeedAddress;
    newPriceFeedWeth = wethPriceFeedAddress;
    newPriceFeedMeth = methPriceFeedAddress;
    newPriceFeedFbtc = fbtcPriceFeedAddress;

    const setBaseTokenPriceFeedCalldataUsde = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [comet.address, newPriceFeedUsde]
    );

    const updateAssetPriceFeedCalldataWeth = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'address'],
      [comet.address, WETH.address, newPriceFeedWeth]
    );

    const updateAssetPriceFeedCalldataMeth = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'address'],
      [comet.address, mETH.address, newPriceFeedMeth]
    );

    const updateAssetPriceFeedCalldataFbtc = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'address'],
      [comet.address, FBTC.address, newPriceFeedFbtc]
    );

    const deployAndUpgradeToCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const l2ProposalData = ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          cometAdmin.address
        ],
        [
          0,
          0,
          0,
          0,
          0
        ],
        [
          'setBaseTokenPriceFeed(address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          setBaseTokenPriceFeedCalldataUsde,
          updateAssetPriceFeedCalldataWeth,
          updateAssetPriceFeedCalldataMeth,
          updateAssetPriceFeedCalldataFbtc,
          deployAndUpgradeToCalldata,
        ]
      ]
    );

    const mainnetActions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet and set reward config on Mantle.
      {
        contract: mantleL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 2_500_000],
      },
    ];
    oldPriceFeedUsde = await comet.baseTokenPriceFeed();
    [,, oldPriceFeedMeth] = await comet.getAssetInfoByAddress(mETH.address);
    [,, oldPriceFeedWeth] = await comet.getAssetInfoByAddress(WETH.address);
    [,, oldPriceFeedFbtc] = await comet.getAssetInfoByAddress(FBTC.address);

    const description = `# Update price feeds in cUSDEv3 on Mantle with CAPO and SVR implementation.

## Proposal summary

This proposal updates existing price feed for USDe, mETH, WETH, and FBTC on the USDe market on Mantle.

### CAPO summary

CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes. mETH price feed is updated to its CAPO implementation.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1072) and [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245).

### CAPO audit

CAPO has been audited by [OpenZeppelin](https://www.comp.xyz/t/capo-price-feed-audit/6631, as well as the LST / LRT implementation [here](https://www.comp.xyz/t/capo-lst-lrt-audit/7118).

### SVR summary

[RFP process](https://www.comp.xyz/t/oev-rfp-process-update-july-2025/6945) and community [vote](https://snapshot.box/#/s:comp-vote.eth/proposal/0x9502fab4d5768e30326948b26780664b6a3e1da00c3c65d32095b5897a35e21d) passed and decided to implement API3 SVR solution for Mantle USDe market, this proposal updates USDe, WETH, mETH and FBTC price feeds to support SVR implementations.


## Proposal actions

The first action updates USDe, mETH, WETH and FBTC price feeds to the CAPO and SVR implementation. This sends the encoded 'setBaseTokenPriceFeed', 'updateAssetPriceFeed' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Mantle.`;

    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
    );

    const event = txn.events.find((event: { event: string }) => event.event === 'ProposalCreated');

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
      WETH,
      mETH,
      FBTC
    } = await deploymentManager.getContracts();

    // Compare USDe base token price feed with Comet configuration
    const cometBaseTokenPriceFeed = await comet.baseTokenPriceFeed();
    expect(cometBaseTokenPriceFeed).to.be.equal(newPriceFeedUsde);

    const configuration = await configurator.getConfiguration(comet.address);
    expect(configuration.baseTokenPriceFeed).to.be.equal(newPriceFeedUsde);

    // Compare mETH asset config with Comet and Configurator asset info
    const cometMETHAssetInfo = await comet.getAssetInfoByAddress(mETH.address);
    expect(cometMETHAssetInfo.priceFeed).to.be.equal(newPriceFeedMeth);

    const configuratorMETHAssetConfig = configuration.assetConfigs.find(((assetConfig: { asset: string, priceFeed: string }) => assetConfig.asset.toLowerCase() === mETH.address.toLowerCase()));
    expect(configuratorMETHAssetConfig.asset).to.be.equal(mETH.address);
    expect(configuratorMETHAssetConfig.priceFeed).to.be.equal(newPriceFeedMeth);

    // Compare WETH asset config with Comet and Configurator asset info
    const cometWETHAssetInfo = await comet.getAssetInfoByAddress(WETH.address);
    expect(cometWETHAssetInfo.priceFeed).to.be.equal(newPriceFeedWeth);

    const configuratorWETHAssetConfig = configuration.assetConfigs.find(((assetConfig: { asset: string, priceFeed: string }) => assetConfig.asset.toLowerCase() === WETH.address.toLowerCase()));
    expect(configuratorWETHAssetConfig.asset).to.be.equal(WETH.address);
    expect(configuratorWETHAssetConfig.priceFeed).to.be.equal(newPriceFeedWeth);

    // Compare FBTC asset config with Comet and Configurator asset info
    const cometFBTCAssetInfo = await comet.getAssetInfoByAddress(FBTC.address);
    expect(cometFBTCAssetInfo.priceFeed).to.be.equal(newPriceFeedFbtc);

    const configuratorFBTCAssetConfig = configuration.assetConfigs.find(((assetConfig: { asset: string, priceFeed: string }) => assetConfig.asset.toLowerCase() === FBTC.address.toLowerCase()));
    expect(configuratorFBTCAssetConfig.asset).to.be.equal(FBTC.address);
    expect(configuratorFBTCAssetConfig.priceFeed).to.be.equal(newPriceFeedFbtc);

    // Ensure old and new price feeds are different
    expect(oldPriceFeedUsde).to.not.equal(newPriceFeedUsde);
    expect(oldPriceFeedMeth).to.not.equal(newPriceFeedMeth);
    expect(oldPriceFeedWeth).to.not.equal(newPriceFeedWeth);
    expect(oldPriceFeedFbtc).to.not.equal(newPriceFeedFbtc);
    
    // Ensure price values from old and new price feeds are equal
    expect(await comet.getPrice(oldPriceFeedUsde)).to.be.closeTo(await comet.getPrice(newPriceFeedUsde), 1e6);
    expect(await comet.getPrice(oldPriceFeedMeth)).to.be.closeTo(await comet.getPrice(newPriceFeedMeth), 1e6);
    expect(await comet.getPrice(oldPriceFeedWeth)).to.be.closeTo(await comet.getPrice(newPriceFeedWeth), 1e6);
    expect(await comet.getPrice(oldPriceFeedFbtc)).to.be.closeTo(await comet.getPrice(newPriceFeedFbtc), 1e6);
  },
});
  