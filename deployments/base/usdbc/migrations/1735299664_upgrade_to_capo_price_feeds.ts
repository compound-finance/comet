import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { utils } from 'ethers';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { Numeric } from '../../../../test/helpers';
import { AggregatorV3Interface, IWstETH } from '../../../../build/types';

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
    return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

const ETH_USD_PRICE_FEED = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';

const CBETH_ADDRESS = '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22';
const CBETH_ETH_PRICE_FEED = '0x806b4Ac04501c29769051e42783cF04dCE41440b';

const FEED_DECIMALS = 8;

let newCbEthToUsdPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { governor } = await deploymentManager.getContracts();
    const now = (await deploymentManager.hre.ethers.provider.getBlock('latest'))!.timestamp;

    //1. cbEth
    const rateProviderCbEth = await deploymentManager.existing('cbEth:_priceFeed', CBETH_ETH_PRICE_FEED, 'base','contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWstEth] = await rateProviderCbEth.latestRoundData();
    const cbEthCapoPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
        [
            governor.address,
            ETH_USD_PRICE_FEED,
            CBETH_ETH_PRICE_FEED,
            "wstETH:priceFeed",
            FEED_DECIMALS,
            3600,
            {
                snapshotRatio: currentRatioWstEth,
                snapshotTimestamp: now - 3600,
                maxYearlyRatioGrowthPercent: exp(0.0404, 4)
            }
        ],
        true
    );

    return {
      cbEthCapoPriceFeedAddress: cbEthCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, {
    cbEthCapoPriceFeedAddress
  }) {

    newCbEthToUsdPriceFeed = cbEthCapoPriceFeedAddress;

    const trace = deploymentManager.tracer();

    const { 
      configurator, 
      comet, 
      bridgeReceiver, 
      cometAdmin 
    } = await deploymentManager.getContracts();

    const {
      governor,
      baseL1CrossDomainMessenger
    } = await govDeploymentManager.getContracts();

    const updateCbEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        CBETH_ADDRESS,
        cbEthCapoPriceFeedAddress
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
        [configurator.address, cometAdmin.address],
        [0, 0],
        ['updateAssetPriceFeed(address,address,address)', 'deployAndUpgradeTo(address,address)'],
        [updateCbEthPriceFeedCalldata, deployAndUpgradeToCalldata],
      ]
    );

    const mainnetActions = [
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [
          bridgeReceiver.address,
          l2ProposalData,
          3_000_000
        ]
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
        
    const cbETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      CBETH_ADDRESS
    );
        
    // 1. & 2. & 3. Check if the price feeds are set correctly.
    const cbETHInCometInfo = await comet.getAssetInfoByAddress(
      CBETH_ADDRESS
      );
        
    const cbETHInConfiguratorInfoWETHComet = (
        await configurator.getConfiguration(comet.address)
    ).assetConfigs[cbETHIndexInComet];
          
    expect(cbETHInCometInfo.priceFeed).to.eq(newCbEthToUsdPriceFeed);
    expect(cbETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newCbEthToUsdPriceFeed);
  },
});
