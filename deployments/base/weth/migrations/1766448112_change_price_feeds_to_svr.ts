import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const ETH_TO_USD_SVR_PRICE_FEED_ADDRESS = '0x1428C9E908e32dD2839F99D63C242c91329A58C0';
const USDC_TO_USD_SVR_PRICE_FEED_ADDRESS = '0x1401Fd60F9ba4F718a2fE6149aadf3d1F0dB1b0A';

let newPriceFeedUSDCAddress: string;

let oldUSDCPriceFeed: string;

export default migration('1766448112_change_price_feeds_to_svr', {
  async prepare(deploymentManager: DeploymentManager) {
    const _usdcPriceFeed = await deploymentManager.deploy(
      'USDC:priceFeed',
      'pricefeeds/ReverseMultiplicativePriceFeed.sol',
      [
        USDC_TO_USD_SVR_PRICE_FEED_ADDRESS, // USDC / USD price feed
        ETH_TO_USD_SVR_PRICE_FEED_ADDRESS,  // ETH / USD price feed
        8,                                  // decimals
        'USDC / ETH SVR price feed'         // description
      ],
      true
    );
    return { USDCPriceFeedAddress: _usdcPriceFeed.address };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    { 
      USDCPriceFeedAddress
    }
  ) => {
    const trace = deploymentManager.tracer();
    newPriceFeedUSDCAddress = USDCPriceFeedAddress;

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      USDC
    } = await deploymentManager.getContracts();

    const { governor, baseL1CrossDomainMessenger } = await govDeploymentManager.getContracts();

    const updateUSDCPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        USDC.address,
        newPriceFeedUSDCAddress
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
        [updateUSDCPriceFeedCalldata, deployAndUpgradeToCalldata],
      ]
    );

    [,, oldUSDCPriceFeed] = await comet.getAssetInfoByAddress(USDC.address);

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

    const description = `# Update USDC price feeds in cWETHv3 on Base with SVR price feeds.

## Proposal summary

This proposal updates existing price feeds for USDC asset on the WETH market on Base.

### SVR summary

[RFP process](https://www.comp.xyz/t/oev-rfp-process-update-july-2025/6945) and community [vote](https://snapshot.box/#/s:comp-vote.eth/proposal/0xffd84200f112926e8b21793ee3750f272fc40a3f90399f86d41971a44aa3edf3) passed and decided to implement Chainlink's SVR solution for BASE markets, this proposal updates USDC price feed to support SVR implementation.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1075) and [forum discussion for SVR](https://www.comp.xyz/t/request-for-proposal-rfp-oracle-extractable-value-oev-solution-for-compound-protocol/6786).

### SVR fee recipient

SVR generates revenue from liquidators and Compound DAO will receive that revenue as part of the protocol fee. The fee recipient for SVR is set to Compound DAO multisig: 0xd9496F2A3fd2a97d8A4531D92742F3C8F53183cB.

## Proposal actions

The first action updates USDC price feed to the SVR implementation. This sends the encoded 'updateAssetPriceFeed' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Base.
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
      USDC,
    } = await deploymentManager.getContracts();

    // 1. USDC
    const USDCIndexInComet = await configurator.getAssetIndex(
      comet.address,
      USDC.address
    );
    const USDCInCometInfo = await comet.getAssetInfoByAddress(USDC.address);
    const USDCInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[USDCIndexInComet];

    expect(USDCInCometInfo.priceFeed).to.eq(newPriceFeedUSDCAddress);
    expect(USDCInConfiguratorInfoWETHComet.priceFeed).to.eq(newPriceFeedUSDCAddress);

    expect(await comet.getPrice(newPriceFeedUSDCAddress)).to.be.closeTo(await comet.getPrice(oldUSDCPriceFeed), 1e8); // 1$
  },
});
