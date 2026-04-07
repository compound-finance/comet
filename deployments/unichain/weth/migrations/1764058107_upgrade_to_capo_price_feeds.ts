import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal, exp } from '../../../../src/deploy';
import { utils } from 'ethers';

const WSTETH_ADDRESS = '0xc02fe7317d4eb8753a02c35fe019786854a92001';
const WSTETH_PRICE_FEED_ADDRESS = '0x73D3e8b769bC687AeEc487AAeFCAd31F4d9F84A7';

const EZETH_ADDRESS = '0x2416092f143378750bb29b79ed961ab195cceea5';
const EZETH_PRICE_FEED_ADDRESS = '0x8671d5e3a10639a573bACffEF448CA076b2d5cD7';

const WEETH_ADDRESS = '0x7dcc39b4d1c53cb31e1abc0e358b43987fef80f7';
const WEETH_PRICE_FEED_ADDRESS = '0x731564585278f228FB8F93a0BF62729E24367662';

const RSETH_ADDRESS = '0xc3eACf0612346366Db554C991D7858716db09f58';
const RSETH_PRICE_FEED_ADDRESS = '0x0090A563C4832E4E519F5f054483519b1A83c8C3';

let oldWstETHToETHPriceFeed: string;
let oldWeETHToETHPriceFeed: string;
let oldEzEthToETHPriceFeed: string;
let oldRsEthToETHPriceFeed: string;

export default migration('1764058107_upgrade_to_capo_price_feeds', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();

    const { 
      configurator, 
      comet, 
      bridgeReceiver, 
      cometAdmin 
    } = await deploymentManager.getContracts();

    const {
      unichainL1CrossDomainMessenger,
      governor
    } = await govDeploymentManager.getContracts();

    const updateWstEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WSTETH_ADDRESS,
        WSTETH_PRICE_FEED_ADDRESS
      )
    );

    const updateWeethPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WEETH_ADDRESS,
        WEETH_PRICE_FEED_ADDRESS
      )
    );

    const updateEzEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        EZETH_ADDRESS,
        EZETH_PRICE_FEED_ADDRESS
      )
    );

    const updateRsEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        RSETH_ADDRESS,
        RSETH_PRICE_FEED_ADDRESS
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
          updateWstEthPriceFeedCalldata,
          updateWeethPriceFeedCalldata,
          updateEzEthPriceFeedCalldata,
          updateRsEthPriceFeedCalldata,
          deployAndUpgradeToCalldata
        ],
      ]
    );

    [,, oldWstETHToETHPriceFeed] = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    [,, oldWeETHToETHPriceFeed] = await comet.getAssetInfoByAddress(WEETH_ADDRESS);
    [,, oldEzEthToETHPriceFeed] = await comet.getAssetInfoByAddress(EZETH_ADDRESS);
    [,, oldRsEthToETHPriceFeed] = await comet.getAssetInfoByAddress(RSETH_ADDRESS);

    const mainnetActions = [
      {
        contract: unichainL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [
          bridgeReceiver.address, // target address on L2
          l2ProposalData,         // calldata
          3_000_000               // gas limit for L2 execution
        ],
        value: exp(0.1, 18)
      },
    ];

    const description = `# Update price feeds in cWETHv3 on Unichain with CAPO implementation.

## Proposal summary

This proposal updates existing price feed for wstETH, weETH, ezETH, and rsETH on the cWETHv3 market on Unichain.

### CAPO summary

CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes. wstETH, weETH, ezETH, and rsETH price feeds are updated to their CAPO implementation.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1068) and [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245).

### CAPO audit

CAPO has been audited by [OpenZeppelin](https://www.comp.xyz/t/capo-price-feed-audit/6631, as well as the LST / LRT implementation [here](https://www.comp.xyz/t/capo-lst-lrt-audit/7118).

## Proposal actions

The first action updates wstETH, weETH, ezETH, and rsETH price feeds to the CAPO implementation. This sends the encoded 'updateAssetPriceFeed' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Unichain.`;

    const txn = await govDeploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      ), 0, 300_000
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

    // 1. wstETH
    const wstETHIndexInComet = await configurator.getAssetIndex(comet.address, WSTETH_ADDRESS);
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    const wstETHInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[wstETHIndexInComet];

    expect(wstETHInCometInfo.priceFeed).to.eq(WSTETH_PRICE_FEED_ADDRESS);
    expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(WSTETH_PRICE_FEED_ADDRESS);
    expect(await comet.getPrice(WSTETH_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldWstETHToETHPriceFeed), 1e6);

    // 2. weETH
    const weEthIndexInComet = await configurator.getAssetIndex(comet.address, WEETH_ADDRESS);
    const weEthInCometInfo = await comet.getAssetInfoByAddress(WEETH_ADDRESS);
    const weEthInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[weEthIndexInComet];

    expect(weEthInCometInfo.priceFeed).to.eq(WEETH_PRICE_FEED_ADDRESS);
    expect(weEthInConfiguratorInfoWETHComet.priceFeed).to.eq(WEETH_PRICE_FEED_ADDRESS);
    expect(await comet.getPrice(WEETH_PRICE_FEED_ADDRESS)).to.be.equal(await comet.getPrice(oldWeETHToETHPriceFeed));

    // 3. ezETH
    const ezEthIndexInComet = await configurator.getAssetIndex(comet.address, EZETH_ADDRESS);
    const ezEthInCometInfo = await comet.getAssetInfoByAddress(EZETH_ADDRESS);
    const ezEthInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[ezEthIndexInComet];

    expect(ezEthInCometInfo.priceFeed).to.eq(EZETH_PRICE_FEED_ADDRESS);
    expect(ezEthInConfiguratorInfoWETHComet.priceFeed).to.eq(EZETH_PRICE_FEED_ADDRESS);
    expect(await comet.getPrice(EZETH_PRICE_FEED_ADDRESS)).to.be.equal(await comet.getPrice(oldEzEthToETHPriceFeed));

    // 4. rsETH
    const rsEthIndexInComet = await configurator.getAssetIndex(comet.address, RSETH_ADDRESS);
    const rsEthInCometInfo = await comet.getAssetInfoByAddress(RSETH_ADDRESS);
    const rsEthInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[rsEthIndexInComet];

    expect(rsEthInCometInfo.priceFeed).to.eq(RSETH_PRICE_FEED_ADDRESS);
    expect(rsEthInConfiguratorInfoWETHComet.priceFeed).to.eq(RSETH_PRICE_FEED_ADDRESS);
    expect(await comet.getPrice(RSETH_PRICE_FEED_ADDRESS)).to.be.equal(await comet.getPrice(oldRsEthToETHPriceFeed));
  },
});
