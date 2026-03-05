import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { utils, Contract } from 'ethers';

const destinationChainSelector = '6916147374840168594';

const USDC_TO_USD_API3_PRICE_FEED_ADDRESS = '0xf061d556F5136263c4d66d9fFCADE8Ab43a3a704';

const GHO_STABLE_TOKEN = '0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f';

let newPriceFeedUSDCAddress: string;
let oldUSDCPriceFeed: string;

export default migration('1772710499_update_usdc_price_feed', {
  async prepare(deploymentManager: DeploymentManager) {
    const _usdcPriceFeed = await deploymentManager.deploy(
      'USDC:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        USDC_TO_USD_API3_PRICE_FEED_ADDRESS, // USDC / USD price feed
        8                                    // decimals
      ],
      true
    );
    return {
      USDCPriceFeedAddress: _usdcPriceFeed.address
    };
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

    const {
      governor, 
      l1CCIPRouter
    } = await govDeploymentManager.getContracts();

    const updateUSDCAssetCalldata = await calldata(
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
        [
          configurator.address,
          cometAdmin.address
        ],
        [ 0, 0 ],
        [
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)'
        ],
        [
          updateUSDCAssetCalldata,
          deployAndUpgradeToCalldata
        ],
      ]
    );

    [,, oldUSDCPriceFeed] = await comet.getAssetInfoByAddress(USDC.address);

    const fee = await l1CCIPRouter.getFee(destinationChainSelector, [
      utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
      l2ProposalData,
      [],
      GHO_STABLE_TOKEN,
      '0x'
    ]);

    const mainnetActions = [
      // 1. Approve GHO stable token transfer to pay for the proposal execution fee on Ronin.
      {
        target: GHO_STABLE_TOKEN,
        signature: 'approve(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(['address', 'uint256'], [l1CCIPRouter.address, fee.mul(2)])
      },
      // 2. Set Comet configuration and deployAndUpgradeTo WETH Comet on Ronin.
      {
        contract: l1CCIPRouter,
        signature: 'ccipSend(uint64,(bytes,bytes,(address,uint256)[],address,bytes))',
        args:
            [
              destinationChainSelector,
              [
                utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
                l2ProposalData,
                [],
                GHO_STABLE_TOKEN,
                '0x'
              ]
            ]
      },
    ];

    const description = `# Update USDC price feed on cWRONv3 on Ronin

## Proposal summary

This proposal updates USDC price feeds to API3, since Chainlink is no longer supported on Ronin.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1093).

## Proposal actions

The first proposal action approves the L1CCIPRouter to transfer GHO stable token from the timelock to pay for the proposal execution fee on Ronin.

The second proposal action sends the following encoded calls to the governance receiver on Ronin:
- Update USDC price feed to API3 oracle
- Deploy and upgrade to new configuration via \`deployAndUpgradeTo\`.
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
      USDC
    } = await deploymentManager.getContracts();

    const USDCIndexInComet = await configurator.getAssetIndex(
      comet.address,
      USDC.address
    );
    const USDCInComet = await comet.getAssetInfoByAddress(USDC.address);
    const USDCInConfigurator = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[USDCIndexInComet];

    expect(USDC.address).to.be.equal(USDCInComet.asset);
    expect(newPriceFeedUSDCAddress).to.eq(USDCInComet.priceFeed);

    expect(USDC.address).to.be.equal(USDCInConfigurator.asset);
    expect(newPriceFeedUSDCAddress).to.eq(USDCInConfigurator.priceFeed);
    
    const newPriceFeedContract = new Contract(newPriceFeedUSDCAddress, [
      'function underlyingPriceFeed() external view returns (address)'
    ],
    await deploymentManager.getSigner()
    );
    expect(await newPriceFeedContract.underlyingPriceFeed()).to.be.equal(USDC_TO_USD_API3_PRICE_FEED_ADDRESS);

    expect(await comet.getPrice(newPriceFeedUSDCAddress)).to.be.closeTo(await comet.getPrice(oldUSDCPriceFeed), 1e6);
  },
});