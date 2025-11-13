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

const ETH_USD_PRICE_FEED = '0x13e3Ee699D1909E989722E753853AE30b17e08c5';

const WSTETH_ADDRESS = '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb';
const WSTETH_STETH_PRICE_FEED_ADDRESS = '0xe59EBa0D492cA53C6f46015EEa00517F2707dc77';

const FEED_DECIMALS = 8;
const blockToFetch = 142800000;

let newWstETHToUSDPriceFeed: string;
let oldWstETHToUSDPriceFeed: string;

export default migration('1761567671_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { timelock } = await deploymentManager.getContracts();
    const blockToFetchTimestamp = (await deploymentManager.hre.ethers.provider.getBlock(blockToFetch))!.timestamp;

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

    return {
      wstEthToUSDCapoPriceFeedAddress: wstEthToUSDCapoPriceFeed.address,
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager, {
    wstEthToUSDCapoPriceFeedAddress,
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

    const updateWstEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WSTETH_ADDRESS,
        wstEthToUSDCapoPriceFeedAddress
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
          cometAdmin.address,
        ],
        [0, 0],
        [
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          updateWstEthPriceFeedCalldata,
          deployAndUpgradeToCalldata,
        ],
      ]
    );

    [,, oldWstETHToUSDPriceFeed ] = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);

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

    const wstETHIndexInComet = await configurator.getAssetIndex(comet.address, WSTETH_ADDRESS);
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    const wstETHInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[wstETHIndexInComet];

    expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHToUSDPriceFeed);
    expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHToUSDPriceFeed);
    expect(await comet.getPrice(newWstETHToUSDPriceFeed)).to.be.closeTo(await comet.getPrice(oldWstETHToUSDPriceFeed), 10e8);
  },
});
