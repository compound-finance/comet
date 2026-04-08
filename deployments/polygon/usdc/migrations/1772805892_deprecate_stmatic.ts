import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';


let newStMaticPriceFeed: string;

export default migration('1772805892_deprecate_stmatic', {
  async prepare(deploymentManager: DeploymentManager) {
    const _stMaticConstantPriceFeed = await deploymentManager.deploy(
      'stMatic:priceFeed',
      'pricefeeds/ConstantPriceFeed.sol',
      [
        8, // decimals
        1  // constantPrice
      ],
      true
    );

    return {
      stMaticConstantPriceFeedAddress: _stMaticConstantPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, {
    stMaticConstantPriceFeedAddress
  }) {
    newStMaticPriceFeed = stMaticConstantPriceFeedAddress;

    const trace = deploymentManager.tracer();

    const { 
      configurator,
      comet,
      bridgeReceiver,
      cometAdmin,
      stMATIC
    } = await deploymentManager.getContracts();

    const {
      governor,
      fxRoot
    } = await govDeploymentManager.getContracts();

    const updateStMaticPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        stMATIC.address,
        newStMaticPriceFeed
      )
    );

    const updateStMaticSupplyCapCalldata = await calldata(
      configurator.populateTransaction.updateAssetSupplyCap(
        comet.address,
        stMATIC.address,
        0
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
        ['updateAssetPriceFeed(address,address,address)', 'updateAssetSupplyCap(address,address,uint128)', 'deployAndUpgradeTo(address,address)'],
        [updateStMaticPriceFeedCalldata, updateStMaticSupplyCapCalldata, deployAndUpgradeToCalldata],
      ]
    );

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Polygon.
      {
        contract: fxRoot,
        signature: 'sendMessageToChild(address,bytes)',
        args: [bridgeReceiver.address, l2ProposalData],
      },
    ];

    const description = `# Deprecate stMATIC in cUSDCv3 on Polygon

## Proposal summary

WOOF! propose to deprecate stMATIC as collateral in cUSDCv3 on Polygon by updating its price feed to a constant price feed with a price of 1 wei and set its supply cap to 0.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1094) and [forum discussion](https://www.comp.xyz/t/gauntlet-depreciating-stmatic-on-polygon-usdt-and-usdc-e-comets/7083).

## Proposal actions

The first action updates stMATIC price feed to the constant price feed with a price of 1 wei and sets its supply cap to 0. This sends the encoded 'updateAssetPriceFeed', 'updateAssetSupplyCap' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Polygon.
`;

    const txn = await deploymentManager.retry(async () =>
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

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator, stMATIC } = await deploymentManager.getContracts();

    const stMaticIndexInComet = await configurator.getAssetIndex(comet.address, stMATIC.address);

    // Check if the price feeds are set correctly.
    const stMaticInCometInfo = await comet.getAssetInfoByAddress(stMATIC.address);
    const stMaticInConfiguratorInfo = (await configurator.getConfiguration(comet.address)).assetConfigs[stMaticIndexInComet];

    expect(stMaticInCometInfo.priceFeed).to.eq(newStMaticPriceFeed);
    expect(stMaticInConfiguratorInfo.priceFeed).to.eq(newStMaticPriceFeed);
    expect(await comet.getPrice(newStMaticPriceFeed)).to.equal(1);

    expect(stMaticInCometInfo.supplyCap).to.eq(0);
    expect(stMaticInConfiguratorInfo.supplyCap).to.eq(0);
  },
});
