import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const RSETH_ADDRESS = '0xc3eACf0612346366Db554C991D7858716db09f58';
const RSETH_ETH_PRICE_FEED_ADDRESS = '0x85C4F855Bc0609D2584405819EdAEa3aDAbfE97D';

let newPriceFeedAddress: string;

export default migration('1753711155_add_rseth_as_collateral', {
  async prepare() {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
  ) => {
    const trace = deploymentManager.tracer();

    const rsETH = await deploymentManager.existing(
      'rsETH',
      RSETH_ADDRESS,
      'unichain',
      'contracts/ERC20.sol:ERC20'
    );
    const rsETHPriceFeed = await deploymentManager.existing(
      'rsETH:priceFeed',
      RSETH_ETH_PRICE_FEED_ADDRESS,
      'unichain'
    );

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const { governor, unichainL1CrossDomainMessenger } = await govDeploymentManager.getContracts();

    const newAssetConfig = {
      asset: rsETH.address,
      priceFeed: rsETHPriceFeed.address,
      decimals: await rsETH.decimals(),
      borrowCollateralFactor: exp(0.90, 18),
      liquidateCollateralFactor: exp(0.93, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(1000, 18),
    };

    newPriceFeedAddress = rsETHPriceFeed.address;

    const addAssetCalldata = await calldata(
      configurator.populateTransaction.addAsset(comet.address, newAssetConfig)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, cometAdmin.address],
        [0, 0],
        [
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)',
        ],
        [addAssetCalldata, deployAndUpgradeToCalldata],
      ]
    );

    const mainnetActions = [
      // Send the proposal to the L2 bridge
      {
        contract: unichainL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },
    ];

    const description = `# Add rsETH as collateral into cWETHv3 on Unichain

## Proposal summary

WOOF! proposes to add rsETH into cWETHv3 on Unichain network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Unichain. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/alphagrowth-add-market-eth-on-unichain/6712/8).

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1003) and [forum discussion](https://www.comp.xyz/t/alphagrowth-add-market-eth-on-unichain/6712).


## Proposal Actions

The first proposal action adds rsETH to the WETH Comet on Unichain. This sends the encoded 'addAsset' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Unichain.`;

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

    const rsETHAssetIndex = Number(await comet.numAssets()) - 1;

    const rsETHAssetConfig = {
      asset: RSETH_ADDRESS,
      priceFeed: newPriceFeedAddress,
      decimals: 18,
      borrowCollateralFactor: exp(0.90, 18),
      liquidateCollateralFactor: exp(0.93, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(1000, 18),
    };

    // 1. Compare proposed asset config with Comet asset info
    const rsETHAssetInfo = await comet.getAssetInfoByAddress(RSETH_ADDRESS);
    expect(rsETHAssetIndex).to.be.equal(rsETHAssetInfo.offset);
    expect(rsETHAssetConfig.asset).to.be.equal(rsETHAssetInfo.asset);
    expect(rsETHAssetConfig.priceFeed).to.be.equal(rsETHAssetInfo.priceFeed);
    expect(exp(1, rsETHAssetConfig.decimals)).to.be.equal(rsETHAssetInfo.scale);
    expect(rsETHAssetConfig.borrowCollateralFactor).to.be.equal(rsETHAssetInfo.borrowCollateralFactor);
    expect(rsETHAssetConfig.liquidateCollateralFactor).to.be.equal(rsETHAssetInfo.liquidateCollateralFactor);
    expect(rsETHAssetConfig.liquidationFactor).to.be.equal(rsETHAssetInfo.liquidationFactor);
    expect(rsETHAssetConfig.supplyCap).to.be.equal(rsETHAssetInfo.supplyCap);

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorRsETHAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[rsETHAssetIndex];
    expect(rsETHAssetConfig.asset).to.be.equal(configuratorRsETHAssetConfig.asset);
    expect(rsETHAssetConfig.priceFeed).to.be.equal(configuratorRsETHAssetConfig.priceFeed);
    expect(rsETHAssetConfig.decimals).to.be.equal(configuratorRsETHAssetConfig.decimals);
    expect(rsETHAssetConfig.borrowCollateralFactor).to.be.equal(configuratorRsETHAssetConfig.borrowCollateralFactor);
    expect(rsETHAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorRsETHAssetConfig.liquidateCollateralFactor);
    expect(rsETHAssetConfig.liquidationFactor).to.be.equal(configuratorRsETHAssetConfig.liquidationFactor);
    expect(rsETHAssetConfig.supplyCap).to.be.equal(configuratorRsETHAssetConfig.supplyCap);
  },
});
