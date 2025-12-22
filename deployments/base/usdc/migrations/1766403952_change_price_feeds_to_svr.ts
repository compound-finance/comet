import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const WETH_TO_USD_SVR_PRICE_FEED_ADDRESS = '0x92014e7f331dFaB2848A5872AA8b2E7b6f3cE8B4';
const USDC_TO_USD_SVR_PRICE_FEED_ADDRESS = '0x3fb418B74Ec30bC3e940221F58A04e16afC6378B';

let oldWETHPriceFeed: string;
let oldUSDCPriceFeed: string;

export default migration('1766403952_change_price_feeds_to_svr', {
  async prepare() {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager
  ) => {
    const trace = deploymentManager.tracer();

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      WETH
    } = await deploymentManager.getContracts();

    const { governor, baseL1CrossDomainMessenger } = await govDeploymentManager.getContracts();

    const updateWEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WETH.address,
        WETH_TO_USD_SVR_PRICE_FEED_ADDRESS
      )
    );

    const updateUSDCPriceFeedCalldata = await calldata(
      configurator.populateTransaction.setBaseTokenPriceFeed(
        comet.address,
        USDC_TO_USD_SVR_PRICE_FEED_ADDRESS
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
        [configurator.address, configurator.address, cometAdmin.address],
        [0, 0, 0],
        ['updateAssetPriceFeed(address,address,address)', 'setBaseTokenPriceFeed(address,address)', 'deployAndUpgradeTo(address,address)'],
        [updateWEthPriceFeedCalldata, updateUSDCPriceFeedCalldata, deployAndUpgradeToCalldata],
      ]
    );

    [,, oldWETHPriceFeed] = await comet.getAssetInfoByAddress(WETH.address);
    oldUSDCPriceFeed = await comet.baseTokenPriceFeed();

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

    const description = `# Update WETH and USDC price feeds in cUSDCv3 on Base with SVR price feeds.

## Proposal summary

This proposal updates existing price feeds for WETH and USDC assets on the USDC market on Base.

### SVR summary

[RFP process](https://www.comp.xyz/t/oev-rfp-process-update-july-2025/6945) and community [vote](https://snapshot.box/#/s:comp-vote.eth/proposal/0xffd84200f112926e8b21793ee3750f272fc40a3f90399f86d41971a44aa3edf3) passed and decided to implement Chainlink's SVR solution for BASE markets, this proposal updates WETH and USDC price feeds to support SVR implementations.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1074) and [forum discussion for SVR](https://www.comp.xyz/t/request-for-proposal-rfp-oracle-extractable-value-oev-solution-for-compound-protocol/6786).

### SVR fee recipient

SVR generates revenue from liquidators and Compound DAO will receive that revenue as part of the protocol fee. The fee recipient for SVR is set to Compound DAO multisig: 0xd9496F2A3fd2a97d8A4531D92742F3C8F53183cB.

## Proposal actions

The first action updates WETH and USDC price feeds to the SVR implementation. This sends the encoded 'updateAssetPriceFeed', 'setBaseTokenPriceFeed' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Base.
`;
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
    const {
      comet,
      configurator,
      WETH
    } = await deploymentManager.getContracts();

    // 1. WETH
    const WETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WETH.address
    );
    const WETHInCometInfo = await comet.getAssetInfoByAddress(WETH.address);
    const WETHInConfiguratorInfo = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[WETHIndexInComet];

    expect(WETHInCometInfo.priceFeed).to.eq(WETH_TO_USD_SVR_PRICE_FEED_ADDRESS);
    expect(WETHInConfiguratorInfo.priceFeed).to.eq(WETH_TO_USD_SVR_PRICE_FEED_ADDRESS);

    expect(await comet.getPrice(WETH_TO_USD_SVR_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldWETHPriceFeed), 5e8); // 5$

    // 2. USDC
    const baseTokenPriceFeedFromComet = await comet.baseTokenPriceFeed();
    const baseTokenPriceFeedFromConfigurator = (
      await configurator.getConfiguration(comet.address)
    ).baseTokenPriceFeed;

    expect(baseTokenPriceFeedFromComet).to.eq(USDC_TO_USD_SVR_PRICE_FEED_ADDRESS);
    expect(baseTokenPriceFeedFromConfigurator).to.eq(USDC_TO_USD_SVR_PRICE_FEED_ADDRESS);

    expect(await comet.getPrice(USDC_TO_USD_SVR_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldUSDCPriceFeed), 1e8); // 1$
  },
});
