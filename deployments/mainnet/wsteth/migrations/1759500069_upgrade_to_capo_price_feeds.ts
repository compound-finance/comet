import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { constants } from 'ethers';
import { Numeric } from '../../../../test/helpers';
import { ILRTOracle, IRateProvider } from '../../../../build/types';

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
  return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

const wstETHToETHPriceFeedAddress = '0x5372Bcf3486D59C23F5fC85745B41F180EFFf881';

//1. rsETH
const RSETH_ADDRESS = '0xa1290d69c65a6fe4df752f95823fae25cb99e5a7';
const RSETH_ORACLE = '0x349A73444b1a310BAe67ef67973022020d70020d';

//2. ezETH
const EZETH_ADDRESS = '0xbf5495Efe5DB9ce00f80364C8B423567e58d2110';
const EZETH_RATE_PROVIDER = '0x387dBc0fB00b26fb085aa658527D5BE98302c84C';

const FEED_DECIMALS = 8;
const RATE_DECIMALS = 18;
const blockToFetchFrom = 23397862; // Block number to fetch historical data from

let newRsEthPriceFeed: string;
let newEzEthPriceFeed: string;

let oldRsEthPriceFeed: string;
let oldEzEthPriceFeed: string;

export default migration('1759500069_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { timelock } = await deploymentManager.getContracts();
    const blockToFetchFromTimestamp = (await deploymentManager.hre.ethers.provider.getBlock(blockToFetchFrom))!.timestamp;

    const constantPriceFeed = await deploymentManager.fromDep('wstETH:priceFeed', 'mainnet', 'wsteth');

    const ethToWstETHPriceFeed = await deploymentManager.deploy(
      'wstETH:reversePriceFeed',
      'pricefeeds/ReverseMultiplicativePriceFeed.sol',
      [
        constantPriceFeed.address,    // ETH price feed
        wstETHToETHPriceFeedAddress,  // wstETH / ETH price feed
        8,                            // decimals
        'ETH / wstETH Price Feed',    // description
      ],
      true
    );

    //1. rsEth
    const rateProviderRsEth = await deploymentManager.existing('rsETH:_priceFeed', RSETH_ORACLE, 'mainnet', 'contracts/capo/contracts/interfaces/ILRTOracle.sol:ILRTOracle') as ILRTOracle;
    const currentRatioRsEth = await rateProviderRsEth.rsETHPrice({ blockTag: blockToFetchFrom });
    const rsEthCapoPriceFeed = await deploymentManager.deploy(
      'rsETH:priceFeed',
      'capo/contracts/RsETHCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        ethToWstETHPriceFeed.address,
        RSETH_ORACLE,
        'rsETH / wstETH CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioRsEth,
          snapshotTimestamp: blockToFetchFromTimestamp,
          maxYearlyRatioGrowthPercent: exp(0.0554, 4) // 5.54%
        }
      ],
      true 
    );

    //2. ezEth
    const rateProviderEzEth = await deploymentManager.existing('ezETH:_priceFeed', EZETH_RATE_PROVIDER, 'mainnet', 'contracts/IRateProvider.sol:IRateProvider') as IRateProvider;
    const currentRatioEzEth = await rateProviderEzEth.getRate({ blockTag: blockToFetchFrom });
    const ezEthCapoPriceFeed = await deploymentManager.deploy(
      'ezETH:priceFeed',
      'capo/contracts/RateBasedCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        ethToWstETHPriceFeed.address,
        rateProviderEzEth.address,
        constants.AddressZero,
        'ezETH / wstETH CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        RATE_DECIMALS,
        {
          snapshotRatio: currentRatioEzEth,
          snapshotTimestamp: blockToFetchFromTimestamp,
          maxYearlyRatioGrowthPercent: exp(0.0707, 4) // 7.07%
        }
      ],
      true
    );

    return {
      rsEthCapoPriceFeedAddress: rsEthCapoPriceFeed.address,
      ezEthCapoPriceFeedAddress: ezEthCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, _, {
    rsEthCapoPriceFeedAddress,
    ezEthCapoPriceFeedAddress
  }) {
    newRsEthPriceFeed = rsEthCapoPriceFeedAddress;
    newEzEthPriceFeed = ezEthCapoPriceFeedAddress;

    const trace = deploymentManager.tracer();

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    [,, oldRsEthPriceFeed] = await comet.getAssetInfoByAddress(RSETH_ADDRESS);
    [,, oldEzEthPriceFeed] = await comet.getAssetInfoByAddress(EZETH_ADDRESS);

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

    const description = `# Update price feeds in cWstETHv3 on Mainnet with CAPO implementation.

## Proposal summary

This proposal updates existing price feeds for rsETH and ezETH on the wstETH market on Mainnet.

### CAPO summary

CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes. rsETH and ezETH price feeds are updated to their CAPO implementations.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1034) and [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245).

## CAPO audit

CAPO has been audited by [OpenZeppelin](https://www.comp.xyz/t/capo-price-feed-audit/6631), as well as the LST / LRT implementation [here](https://www.comp.xyz/t/capo-lst-lrt-audit/7118).

## Proposal actions

The first action updates rsETH price feed.
The second action updates ezETH price feed.
The third action deploys and upgrades Comet to a new version.`;

    const txn = await deploymentManager.retry(async () =>
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

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    // 1. rsETH
    const rsEthIndexInComet = await configurator.getAssetIndex(comet.address, RSETH_ADDRESS);
    const rsEthInCometInfo = await comet.getAssetInfoByAddress(RSETH_ADDRESS);
    const rsEthInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[rsEthIndexInComet];

    expect(rsEthInCometInfo.priceFeed).to.eq(newRsEthPriceFeed);
    expect(rsEthInConfiguratorInfoWETHComet.priceFeed).to.eq(newRsEthPriceFeed);
    expect(await comet.getPrice(newRsEthPriceFeed)).to.be.closeTo(await comet.getPrice(oldRsEthPriceFeed), 1e5);

    // 2. ezETH
    const ezEthIndexInComet = await configurator.getAssetIndex(comet.address, EZETH_ADDRESS);
    const ezEthInCometInfo = await comet.getAssetInfoByAddress(EZETH_ADDRESS);
    const ezEthInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[ezEthIndexInComet];

    expect(ezEthInCometInfo.priceFeed).to.eq(newEzEthPriceFeed);
    expect(ezEthInConfiguratorInfoWETHComet.priceFeed).to.eq(newEzEthPriceFeed);
    expect(await comet.getPrice(newEzEthPriceFeed)).to.be.closeTo(await comet.getPrice(oldEzEthPriceFeed), 1e5);
  },
});
