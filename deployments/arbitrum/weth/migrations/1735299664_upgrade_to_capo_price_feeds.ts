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

const ETH_USD_PRICE_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612';
const WSTETH_ADDRESS = '0x5979D7b546E38E414F7E9822514be443A4800529';
const FEED_DECIMALS = 8;
const EZETH_ADDRESS = '0x2416092f143378750bb29b79eD961ab195CcEea5';
const EZETH_TO_ETH_PRICE_FEED_ADDRESS = '0x989a480b6054389075CBCdC385C18CfB6FC08186';
const RSETH_ORACLE = '0x3222d3De5A9a3aB884751828903044CC4ADC627e';
const RSETH_ADDRESS = '0x4186bfc76e2e237523cbc30fd220fe055156b41f';
const WSTETH_STETH_PRICE_FEED_ADDRESS = '0xB1552C5e96B312d0Bf8b554186F846C40614a540'; 
const STETH_ETH_PRICE_FEED_ADDRESS = '0xded2c52b75B24732e9107377B7Ba93eC1fFa4BAf';

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {

    const { comet } = await deploymentManager.getContracts();
    console.log(`Comet address: ${comet.address}`);
    const { governor } = await deploymentManager.getContracts();

    const wstETH = await ethers.getContractAt('contracts/IWstETH.sol:IWstETH', WSTETH_ADDRESS) as IWstETH;
    console.log(wstETH);
    console.log(`wstETH address: ${wstETH.address}`);

    const rateProviderWstEth = await ethers.getContractAt('contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface', WSTETH_STETH_PRICE_FEED_ADDRESS) as AggregatorV3Interface;
        console.log(rateProviderWstEth);
        console.log(`wstETH address: ${rateProviderWstEth.address}`);
    
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
    console.log(wstEthCapoPriceFeed);
    console.log(`Deployed wstETH capo price feed at ${wstEthCapoPriceFeed.address}`);

    const rateProviderEzEth = await ethers.getContractAt('contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface', EZETH_TO_ETH_PRICE_FEED_ADDRESS) as AggregatorV3Interface;
        console.log(rateProviderEzEth);
        console.log(`ezETH address: ${rateProviderEzEth.address}`);
    
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

    console.log(ezEthCapoPriceFeed);
    console.log(`Deployed ezETH capo price feed at ${ezEthCapoPriceFeed.address}`);
 
    const lrtOracle = await ethers.getContractAt('ILRTOracle', RSETH_ORACLE) as ILRTOracle;

    const currentRatioRsEth = await lrtOracle.rsETHPrice();

    const rsEthCapoPriceFeed = await deploymentManager.deploy(
      'rsETH:capoPriceFeed',
      'capo/contracts/RsETHCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        ETH_USD_PRICE_FEED,
        RSETH_ORACLE,
        FEED_DECIMALS,
        "rsETH CAPO",
        3600,
        {
          snapshotRatio: currentRatioRsEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.01, 4)
        }
      ]
    );

    console.log(rsEthCapoPriceFeed);
    console.log(`Deployed rsETH capo price feed at ${rsEthCapoPriceFeed.address}`);
    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address,
      ezEthCapoPriceFeedAddress: ezEthCapoPriceFeed.address,
      rsEthCapoPriceFeedAddress: rsEthCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager, {
    ezEthCapoPriceFeedAddress,
    wstEthCapoPriceFeedAddress,
    rsEthCapoPriceFeedAddress
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
        RSETH_ADDRESS,
        rsEthCapoPriceFeedAddress
      )
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          configurator.address,
          configurator.address
        ],
        [
          0,
          0,
          0
        ],
        [
          'updateAssetPriceFeed',
          'updateAssetPriceFeed',
          'updateAssetPriceFeed',
        ],
        [
          updateEzEthPriceFeedCalldata,
          updateWstEthPriceFeedCalldata,
          updateRsEthPriceFeedCalldata,
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
  },
});
