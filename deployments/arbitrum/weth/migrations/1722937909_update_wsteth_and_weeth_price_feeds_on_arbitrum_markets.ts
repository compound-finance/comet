import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { ethers } from 'ethers';
import { Contract } from 'ethers';

const WSTETH_ADDRESS = '0x5979D7b546E38E414F7E9822514be443A4800529';
const WEETH_ADDRESS = '0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe';

const WSTETH_STETH_PRICE_FEED_ADDRESS = '0xB1552C5e96B312d0Bf8b554186F846C40614a540';
const STETH_ETH_PRICE_FEED_ADDRESS = '0xded2c52b75B24732e9107377B7Ba93eC1fFa4BAf';
const STETH_USD_PRICE_FEED_ADDRESS = '0x07C5b924399cc23c24a95c8743DE4006a32b7f2a';

const WEETH_EETH_PRICE_FEED_ADDRESS = '0x20bAe7e1De9c596f5F7615aeaa1342Ba99294e12';

const USDT_COMET_ADDRESS = '0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07';
const USDC_COMET_ADDRESS = '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf';

let newWstETHToETHPriceFeed: string;
let newWeETHToETHPriceFeed: string;
let newWstETHToUSDPriceFeed: string;

export default migration('1722937909_update_wsteth_and_weeth_price_feeds_on_arbitrum_markets', {
  async prepare(deploymentManager: DeploymentManager) {
    const _wstETHToUSDPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        WSTETH_STETH_PRICE_FEED_ADDRESS,  // wstETH / stETH price feed
        STETH_USD_PRICE_FEED_ADDRESS,     // stETH / USD price feed 
        8,                                // decimals
        'wstETH / USD price feed',        // description
      ],
      true
    );

    const _wstETHToETHPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        WSTETH_STETH_PRICE_FEED_ADDRESS,  // wstETH / stETH price feed
        STETH_ETH_PRICE_FEED_ADDRESS,     // stETH / ETH price feed 
        8,                                // decimals
        'wstETH / WETH price feed',       // description
      ],
      true
    );

    const _weETHToETHPriceFeed = await deploymentManager.deploy(
      'weETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        WEETH_EETH_PRICE_FEED_ADDRESS,  // weETH / eETH price feed
        8,                              // decimals
      ],
      true
    );

    return {
      wstETHToETHPriceFeed: _wstETHToETHPriceFeed.address,
      weETHToETHPriceFeed: _weETHToETHPriceFeed.address,
      wstETHToUSDPriceFeed: _wstETHToUSDPriceFeed.address
    };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, {
    wstETHToETHPriceFeed,
    weETHToETHPriceFeed,
    wstETHToUSDPriceFeed
  }) => {
    const trace = deploymentManager.tracer();
    const {
      bridgeReceiver,
      timelock: l2Timelock,
      comet,
      cometAdmin,
      configurator
    } = await deploymentManager.getContracts();

    const {
      arbitrumInbox,
      timelock,
      governor
    } = await govDeploymentManager.getContracts();

    const wstETH = await deploymentManager.existing(
      'wstETH',
      WSTETH_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const weETH = await deploymentManager.existing(
      'weETH',
      WEETH_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    newWstETHToETHPriceFeed = wstETHToETHPriceFeed;
    newWeETHToETHPriceFeed = weETHToETHPriceFeed;
    newWstETHToUSDPriceFeed = wstETHToUSDPriceFeed;

    const updateAssetPriceFeedCalldataWstETHToWETHComet = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'address'],
      [comet.address, wstETH.address, wstETHToETHPriceFeed]
    );

    const updateAssetPriceFeedCalldataWeETHToWETHComet = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'address'],
      [comet.address, weETH.address, weETHToETHPriceFeed]
    );

    const updateAssetPriceFeedCalldataWstETHToUSDTComet = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'address'],
      [USDT_COMET_ADDRESS, wstETH.address, wstETHToUSDPriceFeed]
    );

    const updateAssetPriceFeedCalldataWstETHToUSDCComet = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'address'],
      [USDC_COMET_ADDRESS , wstETH.address, wstETHToUSDPriceFeed]
    );

    const deployAndUpgradeToCalldataWETHComet = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const deployAndUpgradeToCalldataUSDCComet = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, USDC_COMET_ADDRESS]
    );

    const deployAndUpgradeToCalldataUSDTComet = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, USDT_COMET_ADDRESS]
    );

    const l2ProposalData = ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          cometAdmin.address,
          cometAdmin.address,
          cometAdmin.address,
        ],
        [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
        ],
        [
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
          'deployAndUpgradeTo(address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          updateAssetPriceFeedCalldataWstETHToWETHComet,
          updateAssetPriceFeedCalldataWeETHToWETHComet,
          updateAssetPriceFeedCalldataWstETHToUSDCComet,
          updateAssetPriceFeedCalldataWstETHToUSDTComet,
          deployAndUpgradeToCalldataWETHComet,
          deployAndUpgradeToCalldataUSDCComet,
          deployAndUpgradeToCalldataUSDTComet
        ]
      ]
    );

    const createRetryableTicketGasParams = await estimateL2Transaction(
      {
        from: applyL1ToL2Alias(timelock.address),
        to: bridgeReceiver.address,
        data: l2ProposalData
      },
      deploymentManager
    );
    const refundAddress = l2Timelock.address;

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo WETH Comet on Arbitrum.
      {
        contract: arbitrumInbox,
        signature: 'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
        args: [
          bridgeReceiver.address,                           // address to,
          0,                                                // uint256 l2CallValue,
          createRetryableTicketGasParams.maxSubmissionCost, // uint256 maxSubmissionCost,
          refundAddress,                                    // address excessFeeRefundAddress,
          refundAddress,                                    // address callValueRefundAddress,
          createRetryableTicketGasParams.gasLimit,          // uint256 gasLimit,
          createRetryableTicketGasParams.maxFeePerGas,      // uint256 maxFeePerGas,
          l2ProposalData,                                   // bytes calldata data
        ],
        value: createRetryableTicketGasParams.deposit
      },
    ];

    const description = '# Update Price Feeds on Arbitrum for LSTs\n\n## Proposal summary\n\nWOOF team suggests to update price feeds for LSTs on Arbitrum markets:\n\n\t-\twstETH on WETH Arbitrum market from market rate to exchange rate\n\t-\tweETH on WETH Arbitrum market from market rate to exchange rate\n\t-\twstETH on USDT Arbitrum market from market rate to exchange rate\n\t-\twstETH on USDC Arbitrum market from market rate to exchange rate\n\nSimulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/903).\n\n\n## Proposal Actions\n\nThe proposal contains only 1 action on Mainnet - send message to arbitrum. There are 7 actions on the Arbitrum side: four first ones are update price feeds and three last actions make comet update to new version.';
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');

    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  }, 

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const wstETHIndexInWETHComet = await configurator.getAssetIndex(
      comet.address,
      WSTETH_ADDRESS
    );

    const weETHIndexInWETHComet = await configurator.getAssetIndex(
      comet.address,
      WEETH_ADDRESS
    );

    const wstETHIndexInUSDCComet = await configurator.getAssetIndex(
      USDC_COMET_ADDRESS,
      WSTETH_ADDRESS
    );

    const wstETHIndexInUSDTComet = await configurator.getAssetIndex(
      USDT_COMET_ADDRESS,
      WSTETH_ADDRESS
    );

    // 1. & 2. & 3. Check if the price feeds are set correctly.
    const wstETHInWETHCometInfo = await comet.getAssetInfoByAddress(
      WSTETH_ADDRESS
    );

    const wstETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wstETHIndexInWETHComet];
  
    expect(wstETHInWETHCometInfo.priceFeed).to.eq(newWstETHToETHPriceFeed);
    expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHToETHPriceFeed);
    
    const weETHInWETHCometInfo = await comet.getAssetInfoByAddress(
      WEETH_ADDRESS
    );

    const weETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[weETHIndexInWETHComet];

    expect(weETHInWETHCometInfo.priceFeed).to.eq(newWeETHToETHPriceFeed);
    expect(weETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWeETHToETHPriceFeed);

    const USDCComet = new Contract(
      USDC_COMET_ADDRESS,
      ['function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      deploymentManager.hre.ethers.provider
    );
    console.log('USDCComet', USDCComet.address);

    const wstETHInUSDCCometInfo = await USDCComet.getAssetInfoByAddress(
      WSTETH_ADDRESS
    );

    const wstETHInConfiguratorInfoUSDCComet = (
      await configurator.getConfiguration(USDC_COMET_ADDRESS)
    ).assetConfigs[wstETHIndexInUSDCComet];

    expect(wstETHInUSDCCometInfo.priceFeed).to.eq(newWstETHToUSDPriceFeed);
    expect(wstETHInConfiguratorInfoUSDCComet.priceFeed).to.eq(newWstETHToUSDPriceFeed);

    const USDTComet = new Contract(
      USDT_COMET_ADDRESS,
      ['function getAssetInfoByAddress(address) external view returns(tuple(uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'],
      deploymentManager.hre.ethers.provider
    );
    console.log('USDTComet', USDTComet.address);

    const wstETHInUSDTCometInfo = await USDTComet.getAssetInfoByAddress(
      WSTETH_ADDRESS
    );

    const wstETHInConfiguratorInfoUSDTComet = (
      await configurator.getConfiguration(USDT_COMET_ADDRESS)
    ).assetConfigs[wstETHIndexInUSDTComet];
    
    expect(wstETHInUSDTCometInfo.priceFeed).to.eq(newWstETHToUSDPriceFeed);
    expect(wstETHInConfiguratorInfoUSDTComet.priceFeed).to.eq(newWstETHToUSDPriceFeed);
  },
});
