import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { utils } from 'ethers';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { Numeric } from '../../../../test/helpers';
import { AggregatorV3Interface, ILRTOracle, IWstETH } from '../../../../build/types';

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
    return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

const ETH_USD_PRICE_FEED = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';

const WSTETH_ADDRESS = '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452';
const WSTETH_STETH_PRICE_FEED_ADDRESS = '0xB88BAc61a4Ca37C43a3725912B1f472c9A5bc061'; 
const STETH_ETH_PRICE_FEED_ADDRESS = '0xf586d0728a47229e747d824a939000Cf21dEF5A0';

const EZETH_ADDRESS = '0x2416092f143378750bb29b79ed961ab195cceea5';
const EZETH_TO_ETH_PRICE_FEED_ADDRESS = '0x960BDD1dFD20d7c98fa482D793C3dedD73A113a3';

const WRSETH_ORACLE = '0x99DAf760d2CFB770cc17e883dF45454FE421616b';
const WRSETH_ADDRESS = '0xEDfa23602D0EC14714057867A78d01e94176BEA0';

const WEETH_ADDRESS = '0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A';
const WEETH_STETH_PRICE_FEED_ADDRESS = '0x35e9D7001819Ea3B39Da906aE6b06A62cfe2c181';

let newWstETHToETHPriceFeed: string;
let newEzETHToETHPriceFeed: string;
let newWrsEthToETHPriceFeed: string;
let newWeEthToETHPriceFeed: string;



const FEED_DECIMALS = 8;
export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { governor } = await deploymentManager.getContracts();
    
    const rateProviderWstEth = await deploymentManager.existing('wstEth:priceFeed', WSTETH_STETH_PRICE_FEED_ADDRESS, 'base', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    
    const [, currentRatioWstEth] = await rateProviderWstEth.latestRoundData();
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    
    const _wstETHToETHPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        WSTETH_STETH_PRICE_FEED_ADDRESS, // wstETH / stETH price feed
        STETH_ETH_PRICE_FEED_ADDRESS,    // stETH / ETH price feed
        8,                               // decimals
        'wstETH / ETH price feed'        // description
      ]
    );


    const wstEthCapoPriceFeed = await deploymentManager.deploy(
        'wstETH:capoPriceFeed',
        'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
            [
                governor.address,
                ETH_USD_PRICE_FEED,
                _wstETHToETHPriceFeed.address,
                "wstETH:capoPriceFeed",
                FEED_DECIMALS,
                3600,
                {
                    snapshotRatio: currentRatioWstEth,
                    snapshotTimestamp: now - 3600,
                    maxYearlyRatioGrowthPercent: exp(0.01, 4)
                }
            ]
        );

    console.log(`Deployed wstETH capo price feed at ${wstEthCapoPriceFeed.address}`);

    newWstETHToETHPriceFeed = wstEthCapoPriceFeed.address;
    
    const rateProviderEzEth = await deploymentManager.existing('ezEth:priceFeed', EZETH_TO_ETH_PRICE_FEED_ADDRESS, 'base', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    
    const [, currentRatioEzEth] = await rateProviderEzEth.latestRoundData();

    const ezEthCapoPriceFeed = await deploymentManager.deploy(
      'ezETH:capoPriceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        ETH_USD_PRICE_FEED,
        EZETH_TO_ETH_PRICE_FEED_ADDRESS,
        'ezETH:capoPriceFeed',
         FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioEzEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.01, 4)
        }
      ],
    )

    console.log(`Deployed ezETH capo price feed at ${ezEthCapoPriceFeed.address}`);

    newEzETHToETHPriceFeed = ezEthCapoPriceFeed.address;
    
    const rateProviderRsEth = await deploymentManager.existing('rsEth:priceFeed', WRSETH_ORACLE, 'base', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;

    const [, currentRatioWrsEth] = await rateProviderRsEth.latestRoundData();

    const rsEthCapoPriceFeed = await deploymentManager.deploy(
      'rsETH:capoPriceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        ETH_USD_PRICE_FEED,
        WRSETH_ORACLE,
        "rsETH CAPO",
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioWrsEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.01, 4)
        }
      ]
    );

    console.log(`Deployed rsETH capo price feed at ${rsEthCapoPriceFeed.address}`);

    newWrsEthToETHPriceFeed = rsEthCapoPriceFeed.address;
  
    const rateProviderWeEth = await deploymentManager.existing('weEth:priceFeed', WEETH_STETH_PRICE_FEED_ADDRESS, 'base', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWeEth] = await rateProviderWeEth.latestRoundData();

    const weEthCapoPriceFeed = await deploymentManager.deploy(
      'weETH:capoPriceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        ETH_USD_PRICE_FEED,
        WEETH_STETH_PRICE_FEED_ADDRESS,
        'weETH:capoPriceFeed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioWeEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.01, 4)
        }
      ]
    );

    console.log(`Deployed weETH capo price feed at ${weEthCapoPriceFeed.address}`);

    newWeEthToETHPriceFeed = weEthCapoPriceFeed.address;

    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address,
      ezEthCapoPriceFeedAddress: ezEthCapoPriceFeed.address,
      rsEthCapoPriceFeedAddress: rsEthCapoPriceFeed.address,
      weEthCapoPriceFeedAddress: weEthCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager, {
    ezEthCapoPriceFeedAddress,
    wstEthCapoPriceFeedAddress,
    rsEthCapoPriceFeedAddress,
    weEthCapoPriceFeedAddress
  }) {

    const trace = deploymentManager.tracer();

    const { configurator, comet, bridgeReceiver, l2Timelock } = await deploymentManager.getContracts();

    const {
      arbitrumInbox,
      timelock,
      governor,
      cometAdmin
    } = await govDeploymentManager.getContracts();


    const updateEzEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        EZETH_ADDRESS,
        ezEthCapoPriceFeedAddress
      )
    );

    const updateWstEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WSTETH_ADDRESS,
        wstEthCapoPriceFeedAddress
      )
    );

    const updateRsEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WRSETH_ADDRESS,
        rsEthCapoPriceFeedAddress
      )
    );

    const updateWeEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WEETH_ADDRESS,
        weEthCapoPriceFeedAddress
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
          'updateAssetPriceFeed',
          'updateAssetPriceFeed',
          'updateAssetPriceFeed',
          'updateAssetPriceFeed',
          'deployAndUpgradeTo'
        ],
        [
          updateEzEthPriceFeedCalldata,
          updateWstEthPriceFeedCalldata,
          updateRsEthPriceFeedCalldata,
          updateWeEthPriceFeedCalldata,
          deployAndUpgradeToCalldata
        ],
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
      // 1. Sends the proposal to the L2
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

    const description = 'tmp';
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

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();
            
    const wstETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WSTETH_ADDRESS
    );

    const ezETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      EZETH_ADDRESS
    );

    const wrsETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WRSETH_ADDRESS
    );

    const weETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WEETH_ADDRESS
    );

    const ezETHInCometInfo = await comet.getAssetInfoByAddress(
      EZETH_ADDRESS
    );

    const ezETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[ezETHIndexInComet];

    expect(ezETHInCometInfo.priceFeed).to.eq(newEzETHToETHPriceFeed);
    expect(ezETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newEzETHToETHPriceFeed);
            
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(
      WSTETH_ADDRESS
    ); 

    const wstETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wstETHIndexInComet];

    expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHToETHPriceFeed);
    expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHToETHPriceFeed);

    const wrsETHInCometInfo = await comet.getAssetInfoByAddress(
      WRSETH_ADDRESS
    );

    const wrsETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wrsETHIndexInComet];

    expect(wrsETHInCometInfo.priceFeed).to.eq(newWrsEthToETHPriceFeed);
    expect(wrsETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWrsEthToETHPriceFeed);

    const weETHInCometInfo = await comet.getAssetInfoByAddress(
      WEETH_ADDRESS
    );

    const weETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[weETHIndexInComet];

    expect(weETHInCometInfo.priceFeed).to.eq(newWeEthToETHPriceFeed);
    expect(weETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWeEthToETHPriceFeed);
  },
});
