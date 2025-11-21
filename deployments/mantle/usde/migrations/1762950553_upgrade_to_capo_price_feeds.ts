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

const METH_ADDRESS = '0xcDA86A272531e8640cD7F1a92c01839911B90bb0';
const METH_TO_ETH_PRICE_FEED_ADDRESS = '0xBeaa52edFeB12da4F026b38eD6203938a9936EDF';
const ETH_TO_USD_PRICE_FEED_ADDRESS = '0x61A31634B4Bb4B9C2556611f563Ed86cE2D4643B';

const FEED_DECIMALS = 8;
const blockToFetchFrom = 86000000;

let newMETHToUSDPriceFeed: string;
let oldMETHToUSDPriceFeed: string;

export default migration('1762950553_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { timelock } = await deploymentManager.getContracts();

    //1. mEth
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

    return {
      mEthCapoPriceFeedAddress: mEthCapoPriceFeed.address
    };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    {
      mEthCapoPriceFeedAddress
    }
  ) => {
    newMETHToUSDPriceFeed = mEthCapoPriceFeedAddress;
    const trace = deploymentManager.tracer();
  
    const {
      configurator,
      comet,
      bridgeReceiver, 
      cometAdmin
    } = await deploymentManager.getContracts();
  
    const {
      mantleL1CrossDomainMessenger,
      governor,
    } = await govDeploymentManager.getContracts();
  
    const updateMEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        METH_ADDRESS,
        mEthCapoPriceFeedAddress
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
          cometAdmin.address
        ],
        [
          0,
          0,
        ],
        [
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)'
        ],
        [
          updateMEthPriceFeedCalldata,
          deployAndUpgradeToCalldata
        ],
      ]
    );
    
     
    [,, oldMETHToUSDPriceFeed] = await comet.getAssetInfoByAddress(METH_ADDRESS);

    const mainnetActions = [
      // 1. Sends the proposal to the L2
      {
        contract: mantleL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [
          bridgeReceiver.address,  // address to
          l2ProposalData,          // bytes calldata data
          2_500_000                // uint32 value
        ],
      },
    ];
  
    const description = `# Update price feeds in cUSDEv3 on Mantle with CAPO implementation.

## Proposal summary

This proposal updates existing price feed for mETH on the USDe market on Mantle.

### CAPO summary

CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes. mETH price feed is updated to their CAPO implementations.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1066) and [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245).

### CAPO audit

CAPO has been audited by [OpenZeppelin](https://www.comp.xyz/t/capo-price-feed-audit/6631, as well as the LST / LRT implementation [here](https://www.comp.xyz/t/capo-lst-lrt-audit/7118).

## Proposal actions

The first action updates mETH price feed to the CAPO implementation. This sends the encoded 'updateAssetPriceFeed' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Mantle.`;
    const txn = await govDeploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      )
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

    const mETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      METH_ADDRESS
    );

    const mETHInCometInfo = await comet.getAssetInfoByAddress(
      METH_ADDRESS
    );
    const mETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[mETHIndexInComet]; 

    expect(mETHInCometInfo.priceFeed).to.eq(newMETHToUSDPriceFeed);
    expect(mETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newMETHToUSDPriceFeed);

    expect(await comet.getPrice(newMETHToUSDPriceFeed)).to.be.equal(await comet.getPrice(oldMETHToUSDPriceFeed));
  },
});
