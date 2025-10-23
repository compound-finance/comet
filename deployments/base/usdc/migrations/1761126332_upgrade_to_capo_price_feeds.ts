import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const WSTETH_USD_CAPO_PRICE_FEED = '0x731564585278f228FB8F93a0BF62729E24367662';

const WSTETH_ADDRESS = '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452';

let oldWstETHPriceFeed: string;

export default migration('1761126332_upgrade_to_capo_price_feeds', {
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
      governor,
      baseL1CrossDomainMessenger
    } = await govDeploymentManager.getContracts();

    const updateWstEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WSTETH_ADDRESS,
        WSTETH_USD_CAPO_PRICE_FEED
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

    [,, oldWstETHPriceFeed] = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);

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

    const description = `# Update wstETH price feed in cUSDCv3 on Base with CAPO implementation.

## Proposal summary

This proposal updates existing price feeds for wstETH on the USDC market on Base.

### CAPO summary

CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes. wstETH price feed is updated to their CAPO implementations.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1039) and [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245).

### CAPO audit

CAPO has been audited by [OpenZeppelin](https://www.comp.xyz/t/capo-price-feed-audit/6631, as well as the LST / LRT implementation [here](https://www.comp.xyz/t/capo-lst-lrt-audit/7118).

## Proposal actions

The first action updates wstETH price feed to the CAPO implementation. This sends the encoded 'updateAssetPriceFeed' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Base.
`;

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

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const wstETHIndexInComet = await configurator.getAssetIndex(comet.address, WSTETH_ADDRESS);

    // Check if the price feeds are set correctly.
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    const wstETHInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[wstETHIndexInComet];

    expect(wstETHInCometInfo.priceFeed).to.eq(WSTETH_USD_CAPO_PRICE_FEED);
    expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(WSTETH_USD_CAPO_PRICE_FEED);
    expect(await comet.getPrice(WSTETH_USD_CAPO_PRICE_FEED)).to.be.closeTo(await comet.getPrice(oldWstETHPriceFeed), 7e8); // 7$ tolerance
  },
});
