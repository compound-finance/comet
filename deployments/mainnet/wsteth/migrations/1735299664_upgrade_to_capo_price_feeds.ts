import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { utils } from 'ethers';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { Numeric } from '../../../../test/helpers';
import { AggregatorV3Interface, ILRTOracle, IRateProvider, IWstETH } from '../../../../build/types';

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
    return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

//1. rsETH
const RSETH_ORACLE = '0x349A73444b1a310BAe67ef67973022020d70020d';
const RSETH_ADDRESS = '0xa1290d69c65a6fe4df752f95823fae25cb99e5a7';

//2. ezETH
const EZETH_ADDRESS = '0xbf5495Efe5DB9ce00f80364C8B423567e58d2110';
const EZETH_RATE_PROVIDER = '0x387dBc0fB00b26fb085aa658527D5BE98302c84C';


const FEED_DECIMALS = 8;
const RATE_DECIMALS = 18;

let newRsEthToETHPriceFeed: string;
let newEzEthToETHPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { governor } = await deploymentManager.getContracts();
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;

    const constantPriceFeed = await deploymentManager.deploy(
        'ETH:priceFeed',
        'pricefeeds/ConstantPriceFeed.sol',
        [
            8,
            exp(1, 8)
        ]
    );

    //1. rsEth
    const rateProviderRsEth = await deploymentManager.existing('rsETH:_priceFeed', RSETH_ORACLE, 'mainnet', 'contracts/capo/contracts/interfaces/ILRTOracle.sol:ILRTOracle') as ILRTOracle;
    const currentRatioRsEth = await rateProviderRsEth.rsETHPrice();
    const rsEthCapoPriceFeed = await deploymentManager.deploy(
      'rsETH:priceFeed',
      'capo/contracts/RsETHCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        RSETH_ORACLE,
        "rsETH:priceFeed",
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioRsEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.01, 4)
        }
      ],
      true 
    );

    //2. ezEth
    const rateProviderEzEth = await deploymentManager.existing('ezETH:_priceFeed', EZETH_RATE_PROVIDER, 'mainnet', 'contracts/IRateProvider.sol:IRateProvider') as IRateProvider;
    const currentRatioEzEth = await rateProviderEzEth.getRate();
    const ezEthCapoPriceFeed = await deploymentManager.deploy(
      'ezETH:priceFeed',
      'capo/contracts/RateBasedCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        rateProviderEzEth.address,
        ethers.constants.AddressZero,
        'ezETH:priceFeed',
        FEED_DECIMALS,
        3600,
        RATE_DECIMALS,
        {
          snapshotRatio: currentRatioEzEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.01, 4)
        }
      ],
      true
    )

    return {
      rsEthCapoPriceFeedAddress: rsEthCapoPriceFeed.address,
      ezEthCapoPriceFeedAddress: ezEthCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, _, {
    rsEthCapoPriceFeedAddress,
    ezEthCapoPriceFeedAddress
  }) {
    newRsEthToETHPriceFeed = rsEthCapoPriceFeedAddress;
    newEzEthToETHPriceFeed = ezEthCapoPriceFeedAddress;
    
    const trace = deploymentManager.tracer();

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const mainnetActions = [
      // 1. Update rsETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, RSETH_ADDRESS, rsEthCapoPriceFeedAddress],
      },
      // 2. Update ezETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, EZETH_ADDRESS, ezEthCapoPriceFeedAddress],
      },
      // 3. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = ''

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
    
    const rsEthIndexInComet = await configurator.getAssetIndex(
      comet.address,
      RSETH_ADDRESS
    );

    const rsEthInCometInfo = await comet.getAssetInfoByAddress(
      RSETH_ADDRESS
    );

    const rsEthInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[rsEthIndexInComet];
    expect(rsEthInCometInfo.priceFeed).to.eq(newRsEthToETHPriceFeed);
    expect(rsEthInConfiguratorInfoWETHComet.priceFeed).to.eq(newRsEthToETHPriceFeed);

    const ezEthIndexInComet = await configurator.getAssetIndex(
      comet.address,
      EZETH_ADDRESS
    );

    const ezEthInCometInfo = await comet.getAssetInfoByAddress(
      EZETH_ADDRESS
    );

    const ezEthInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[ezEthIndexInComet];  
    
    expect(ezEthInCometInfo.priceFeed).to.eq(newEzEthToETHPriceFeed);
    expect(ezEthInConfiguratorInfoWETHComet.priceFeed).to.eq(newEzEthToETHPriceFeed);

  },
});
