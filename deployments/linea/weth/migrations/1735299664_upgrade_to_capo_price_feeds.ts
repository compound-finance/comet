import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { Numeric } from '../../../../test/helpers';
import { AggregatorV3Interface } from '../../../../build/types';

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
  return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

const WSTETH_ADDRESS = '0xB5beDd42000b71FddE22D3eE8a79Bd49A568fC8F';
const WSTETH_STETH_PRICE_FEED_ADDRESS = '0x3C8A95F2264bB3b52156c766b738357008d87cB7';

const EZETH_ADDRESS = '0x2416092f143378750bb29b79eD961ab195CcEea5';
const EZETH_TO_ETH_PRICE_FEED_ADDRESS = '0xB1d9A4Fe9331E28C5588B63343BF064A397aadB8';

const WEETH_ADDRESS = '0x1Bf74C010E6320bab11e2e5A532b5AC15e0b8aA6';
const WEETH_TO_ETH_RATE_PROVIDER = '0xC4bF21Ab46bd22Cf993c0AAa363577bD2Af83544';

const WRSETH_ADDRESS = '0xD2671165570f41BBB3B0097893300b6EB6101E6C';
const WRSETH_ETH_RATE_PROVIDER = '0xEEDF0B095B5dfe75F3881Cb26c19DA209A27463a';

const FEED_DECIMALS = 8;

let newWstETHToETHPriceFeed: string;
let newEzETHToETHPriceFeed: string;
let newWeEthToETHPriceFeed: string;
let newWrsethToETHPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { governor } = await deploymentManager.getContracts();
    const now = (await deploymentManager.hre.ethers.provider.getBlock('latest'))!.timestamp;

    const constantPriceFeed = await deploymentManager.deploy(
        'eth:constantPriceFeed',
        'pricefeeds/ConstantPriceFeed.sol',
        [
          8,
          exp(1, 8)
        ],
        true
      );

    //1. wstEth
    const rateProviderWstEth = await deploymentManager.existing('wstETH:_rateProvider', WSTETH_STETH_PRICE_FEED_ADDRESS, 'linea', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWstEth] = await rateProviderWstEth.latestRoundData();
    
  
    const wstEthCapoPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        WSTETH_STETH_PRICE_FEED_ADDRESS,
        'wstETH:priceFeed',
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
    
    //2. ezEth
    const rateProviderEzEth = await deploymentManager.existing('ezETH:_priceFeed', EZETH_TO_ETH_PRICE_FEED_ADDRESS, 'linea', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioEzEth] = await rateProviderEzEth.latestRoundData();
    const ezEthCapoPriceFeed = await deploymentManager.deploy(
      'ezETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        EZETH_TO_ETH_PRICE_FEED_ADDRESS,
        'ezETH:priceFeed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioEzEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.0707, 4)
        }
      ],
      true
    );

    //3. weEth
    const weethRateProvider = await deploymentManager.existing('weETH:_priceFeed', WEETH_TO_ETH_RATE_PROVIDER, 'linea', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWeeth] = await weethRateProvider.latestRoundData();
        
    const weethCapoPriceFeed = await deploymentManager.deploy(
        'weETH:priceFeed',
        'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
        [
          governor.address,
          constantPriceFeed.address,
          weethRateProvider.address,
          'weeth:priceFeed',
          FEED_DECIMALS,
          3600,
          {
            snapshotRatio: currentRatioWeeth,
            snapshotTimestamp: now - 3600,
            maxYearlyRatioGrowthPercent: exp(0.0323, 4)
          }
        ],
        true
      );

    //4. wrsEth
    const wrsethRateProvider = await deploymentManager.existing('wrsETH:_priceFeed', WRSETH_ETH_RATE_PROVIDER, 'linea', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWrseth] = await wrsethRateProvider.latestRoundData();
    const wrsethCapoPriceFeed = await deploymentManager.deploy(
        'wrsETH:priceFeed',
        'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
        [
          governor.address,
          constantPriceFeed.address,
          wrsethRateProvider.address,
          'wrsETH:priceFeed',
          FEED_DECIMALS,
          3600,
          {
            snapshotRatio: currentRatioWrseth,
            snapshotTimestamp: now - 3600,
            maxYearlyRatioGrowthPercent: exp(0.0554, 4)
          }
        ],
        true
      );

    
    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address,
      ezEthCapoPriceFeedAddress: ezEthCapoPriceFeed.address,
      weEthCapoPriceFeedAddress: weethCapoPriceFeed.address,
      wrsEthCapoPriceFeedAddress: wrsethCapoPriceFeed.address
    };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    {
      ezEthCapoPriceFeedAddress,
      wstEthCapoPriceFeedAddress,
      weEthCapoPriceFeedAddress,
      wrsEthCapoPriceFeedAddress
    }
  ) => {
    newEzETHToETHPriceFeed = ezEthCapoPriceFeedAddress;
    newWstETHToETHPriceFeed = wstEthCapoPriceFeedAddress;
    newWeEthToETHPriceFeed = weEthCapoPriceFeedAddress;
    newWrsethToETHPriceFeed = wrsEthCapoPriceFeedAddress;

    const trace = deploymentManager.tracer();

    const {
      configurator,
      comet,
      bridgeReceiver, 
      cometAdmin
    } = await deploymentManager.getContracts();

    const {
      lineaMessageService,
      governor,
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

    const updateWeEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WEETH_ADDRESS,
        weEthCapoPriceFeedAddress
      )
    );

    const updateWrsethPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WRSETH_ADDRESS,
        wrsEthCapoPriceFeedAddress
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
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)'
        ],
        [
          updateEzEthPriceFeedCalldata,
          updateWstEthPriceFeedCalldata,
          updateWeEthPriceFeedCalldata,
          updateWrsethPriceFeedCalldata,
          deployAndUpgradeToCalldata
        ],
      ]
    );

    const mainnetActions = [
      // 1. Sends the proposal to the L2
      {
        contract: lineaMessageService,
        signature: 'sendMessage(address,uint256,bytes)',
        args: [
          bridgeReceiver.address,  // address to
          0,                       // uint256 value
          l2ProposalData          // bytes calldata data
        ],
        value: 0
      },
    ];

    const description = 'tmp';
    const txn = await govDeploymentManager.retry(async () =>
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

    const weETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WEETH_ADDRESS
    );

    const wrsethIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WRSETH_ADDRESS
    );
  
    // 1. & 2. & 3. Check if the price feeds are set correctly.
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(
      WSTETH_ADDRESS
    );
  
    const wstETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wstETHIndexInComet];
    
    expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHToETHPriceFeed);
    expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHToETHPriceFeed);
      
    const ezETHInWETHCometInfo = await comet.getAssetInfoByAddress(
      EZETH_ADDRESS
    );  
    const ezETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[ezETHIndexInComet];

    expect(ezETHInWETHCometInfo.priceFeed).to.eq(newEzETHToETHPriceFeed);
    expect(ezETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newEzETHToETHPriceFeed);

    const weEthInCometInfo = await comet.getAssetInfoByAddress(
      WEETH_ADDRESS
    );
    const weEthInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[weETHIndexInComet];
    expect(weEthInCometInfo.priceFeed).to.eq(newWeEthToETHPriceFeed);
    expect(weEthInConfiguratorInfoWETHComet.priceFeed).to.eq(newWeEthToETHPriceFeed);

    const wrsethInCometInfo = await comet.getAssetInfoByAddress(
      WRSETH_ADDRESS
    );
    const wrsethInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wrsethIndexInComet];
    expect(wrsethInCometInfo.priceFeed).to.eq(newWrsethToETHPriceFeed);
    expect(wrsethInConfiguratorInfoWETHComet.priceFeed).to.eq(newWrsethToETHPriceFeed);
  },
});
