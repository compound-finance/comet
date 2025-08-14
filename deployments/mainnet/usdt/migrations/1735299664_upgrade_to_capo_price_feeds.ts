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

const ETH_USD_PRICE_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';
const USDM_USD_PRICE_FEED = '0x079674468Fee6ab45aBfE986737A440701c49BdB';
const WSTETH_ADDRESS = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
const WSTETH_RATE_PROVIDER = '0x86392dC19c0b719886221c78AB11eb8Cf5c52812';

const WUSDM_ADDRESS = '0x57f5e098cad7a3d1eed53991d4d66c45c9af7812';
const FEED_DECIMALS = 8;

let newWstETHToUSDPriceFeed: string;
let newWusdmToUSDPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {

    const { comet } = await deploymentManager.getContracts();
    console.log(`Comet address: ${comet.address}`);
    const { governor } = await deploymentManager.getContracts();

    const wstETH = await deploymentManager.existing('wstEth', WSTETH_ADDRESS, 'base', 'contracts/IWstETH.sol:IWstETH') as IWstETH;
    console.log(`wstETH address: ${wstETH.address}`);

    const currentRatioWstEth = await wstETH.stEthPerToken();
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;


    const wstEthCapoPriceFeed = await deploymentManager.deploy(
        'wstETH:capoPriceFeed',
        'capo/contracts/WstETHCorrelatedAssetsPriceOracle.sol',
            [
                governor.address,
                ETH_USD_PRICE_FEED,
                wstETH.address,
                WSTETH_RATE_PROVIDER,
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
    newWstETHToUSDPriceFeed = wstEthCapoPriceFeed.address;

    const wusdmCapoPriceFeed = await deploymentManager.deploy(
      'wusdm:capoPriceFeed',
      'capo/contracts/ERC4626CorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        USDM_USD_PRICE_FEED,
        WUSDM_ADDRESS,
        'wusdm:capoPriceFeed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioWstEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.01, 4)
        }
      ]
    );

    console.log(`Deployed wusdm capo price feed at ${wusdmCapoPriceFeed.address}`);
    newWusdmToUSDPriceFeed = wusdmCapoPriceFeed.address;

    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address,
      wusdmCapoPriceFeedAddress: wusdmCapoPriceFeed.address
    };
  },

 async enact(deploymentManager: DeploymentManager, _, {
     wstEthCapoPriceFeedAddress,
     wusdmCapoPriceFeedAddress
   }) {
     const trace = deploymentManager.tracer();
 
     const {
       governor,
       comet,
       cometAdmin,
       configurator,
     } = await deploymentManager.getContracts();
 
     const mainnetActions = [
       // 1. Update wstETH price feed
       {
         contract: configurator,
         signature: 'updateAssetPriceFeed(address,address,address)',
         args: [comet.address, WSTETH_ADDRESS, wstEthCapoPriceFeedAddress],
       },
       // 2. Update wusdm price feed
       {
          contract: configurator,
          signature: 'updateAssetPriceFeed(address,address,address)',
          args: [comet.address, WUSDM_ADDRESS, wusdmCapoPriceFeedAddress],
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
                  
    const wstETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WSTETH_ADDRESS
    );

    const wusdmIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WUSDM_ADDRESS
    );
      
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(
      WSTETH_ADDRESS
    ); 
      
    const wstETHInConfiguratorInfoWETHComet = (
        await configurator.getConfiguration(comet.address)
    ).assetConfigs[wstETHIndexInComet];
      
    expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHToUSDPriceFeed);
    expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHToUSDPriceFeed);

    const wusdmInCometInfo = await comet.getAssetInfoByAddress(
      WUSDM_ADDRESS
    );  

    const wusdmInConfiguratorInfoWETHComet = (
        await configurator.getConfiguration(comet.address)
    ).assetConfigs[wusdmIndexInComet];

    expect(wusdmInCometInfo.priceFeed).to.eq(newWusdmToUSDPriceFeed);
    expect(wusdmInConfiguratorInfoWETHComet.priceFeed).to.eq(newWusdmToUSDPriceFeed); 
  },
});
