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

const AERO_USD_PRICE_FEED = '0x4EC5970fC728C5f65ba413992CD5fF6FD70fcfF0';
const ETH_USD_PRICE_FEED = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';

const WSTETH_ADDRESS = '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452';
const WSTETH_STETH_PRICE_FEED_ADDRESS = '0xB88BAc61a4Ca37C43a3725912B1f472c9A5bc061'; 
const STETH_ETH_PRICE_FEED_ADDRESS = '0xf586d0728a47229e747d824a939000Cf21dEF5A0';

const FEED_DECIMALS = 8;

let newWstETHToAeroPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { governor } = await deploymentManager.getContracts();
    const now = (await deploymentManager.hre.ethers.provider.getBlock('latest'))!.timestamp;

    //1. wstEth
    const rateProviderWstEth = await deploymentManager.existing('wstEth:priceFeed', WSTETH_STETH_PRICE_FEED_ADDRESS, 'base', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWstEth] = await rateProviderWstEth.latestRoundData();
    const ethToAeroPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'pricefeeds/ReverseMultiplicativePriceFeed.sol',
      [
        ETH_USD_PRICE_FEED,
        AERO_USD_PRICE_FEED, // USD / AERO price feed
        8,                                            // decimals
        'ETH / USD / AERO price feed' // description
      ],
      true
    );

    const _wstETHToETHPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        WSTETH_STETH_PRICE_FEED_ADDRESS, // wstETH / stETH price feed
        STETH_ETH_PRICE_FEED_ADDRESS,    // stETH / ETH price feed
        8,                               // decimals
        'wstETH / ETH price feed'        // description
      ],
      true
    );

    const wstEthCapoPriceFeed = await deploymentManager.deploy(
    'wstETH:capoPriceFeed',
    'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
        [
            governor.address,
            ethToAeroPriceFeed.address,
            _wstETHToETHPriceFeed.address,
            "wstETH:capoPriceFeed",
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
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, {
    wstEthCapoPriceFeedAddress
  }) {

    newWstETHToAeroPriceFeed = wstEthCapoPriceFeedAddress;

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

    const updateWstEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WSTETH_ADDRESS,
        wstEthCapoPriceFeedAddress
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
        [updateWstEthPriceFeedCalldata, deployAndUpgradeToCalldata],
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
      
      const wstETHIndexInComet = await configurator.getAssetIndex(
        comet.address,
        WSTETH_ADDRESS
      );
      
      // 1. & 2. & 3. Check if the price feeds are set correctly.
      const wstETHInCometInfo = await comet.getAssetInfoByAddress(
        WSTETH_ADDRESS
        );
      
      const wstETHInConfiguratorInfoWETHComet = (
          await configurator.getConfiguration(comet.address)
        ).assetConfigs[wstETHIndexInComet];
        
      expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHToAeroPriceFeed);
      expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHToAeroPriceFeed);
    },
});
