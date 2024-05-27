import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, exp, proposal } from '../../../../src/deploy';

import { expect } from 'chai';
import { utils } from 'ethers';

const cometAddress = '0xA17581A9E3356d9A858b789D68B4d866e593aE94';

const RSETH_ADDRESS = '0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7';
const RSETH_PRICE_FEED_ADDRESS = '0x03c68933f7a3F76875C0bc670a58e69294cDFD01';
const PROPOSED_RSETH_ASSET_INFO = {
  asset: RSETH_ADDRESS,
  priceFeed: RSETH_PRICE_FEED_ADDRESS,
  decimals: 18,
  borrowCollateralFactor: exp(0.90, 18),
  liquidateCollateralFactor: exp(0.93, 18),
  liquidationFactor: exp(0.92, 18),
  supplyCap: exp(0, 18)
};

const WEETH_ADDRESS = '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee';
const WEETH_PRICE_FEED_ADDRESS = '0x5c9C449BbC9a6075A2c061dF312a35fd1E05fF22';
const PROPOSED_WEETH_ASSET_INFO = {
  asset: WEETH_ADDRESS,
  priceFeed: WEETH_PRICE_FEED_ADDRESS,
  decimals: 18,
  borrowCollateralFactor: exp(0.90, 18),
  liquidateCollateralFactor: exp(0.93, 18),
  liquidationFactor: exp(0.92, 18),
  supplyCap: exp(0, 18)
};

export default migration('1716798961_add_rseth_and_weeth', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();

    const rsETH = await deploymentManager.existing(
      'rsETH',
      RSETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const rsethPricefeed = await deploymentManager.existing(
      'rsETH:priceFeed',
      RSETH_PRICE_FEED_ADDRESS,
      'mainnet'
    );

    const weETH = await deploymentManager.existing(
      'weETH',
      WEETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );

    const weethPricefeed = await deploymentManager.existing(
      'weETH:priceFeed',
      WEETH_PRICE_FEED_ADDRESS,
      'mainnet'
    );

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      timelock,
      cbETH
    } = await deploymentManager.getContracts();

    const newAssetConfig = {
      asset: weETH.address,
      priceFeed: weethPricefeed.address,
      decimals: await weETH.decimals(),
      borrowCollateralFactor: exp(0.55, 18),
      liquidateCollateralFactor: exp(0.60, 18),
      liquidationFactor: exp(0.93, 18),
      supplyCap: exp(6_000_000, 18),
    };
    const addAssetCalldata = await calldata(
      configurator.populateTransaction.addAsset(cometAddress, newAssetConfig)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, cometAddress]
    );

    // await governor

    const actions = [
      // 1. Add rsETH in Configurator
      {
        target: configurator.address,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        calldata: addAssetCalldata,
      },
      // {
      //   contract: configurator,
      //   signature: "updateAssetSupplyCap(address,address,uint128)",
      //   args: [comet.address, cbETH.address, exp(35_000, 18)],
      // },
      // 2. Add weETH in Configurator
      
      // 3. Deploy and upgrade to a new version of Comet
      {
        target: cometAdmin.address,
        signature: 'deployAndUpgradeTo(address,address)',
        calldata: deployAndUpgradeToCalldata,
      },
    ];
    const description = '# Increase cbETH Supply Cap in cWETHv3\n\n## Explanation\n\nThe cWETHv3 market is currently limited by the cbETH supply cap, which has been reached.\n\nThe associated forum post for this proposal can be found [here](https://www.comp.xyz/t/compound-v3-usdc-comet-risk-parameter-updates-2023-02-08).\n\n## Proposal\n\nThe proposal itself is to be made from [this pull request](https://github.com/compound-finance/comet/pull/678).\n\nThe first action of the proposal sets the configurator supply cap for cbETH to 30,000 from the current cap of 20,000.\n\nThe second action deploys and upgrades to a new implementation of Comet, using the newly configured parameters.';
    const txn = await deploymentManager.retry(
      async () => governor.propose(...await proposal(actions, description))
    );
    trace(txn);

    const event = (await txn.wait()).events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet
    } = await deploymentManager.getContracts();

    const rsETHAssetIndex = 3;
    const rsETHInfo = await comet.getAssetInfoByAddress(RSETH_ADDRESS);
    expect(rsETHInfo.offset).to.be.eq(rsETHAssetIndex);
    expect(rsETHInfo.asset).to.be.eq(RSETH_ADDRESS);
    expect(rsETHInfo.priceFeed).to.be.eq(RSETH_PRICE_FEED_ADDRESS);
    expect(rsETHInfo.scale).to.be.eq(exp(1, PROPOSED_RSETH_ASSET_INFO.decimals));
    expect(rsETHInfo.borrowCollateralFactor).to.be.eq(PROPOSED_RSETH_ASSET_INFO.borrowCollateralFactor);
    expect(rsETHInfo.liquidateCollateralFactor).to.be.eq(PROPOSED_RSETH_ASSET_INFO.liquidateCollateralFactor);
    expect(rsETHInfo.liquidationFactor).to.be.eq(PROPOSED_RSETH_ASSET_INFO.liquidationFactor);
    expect(rsETHInfo.supplyCap).to.be.eq(PROPOSED_RSETH_ASSET_INFO.supplyCap);
    
    const weETHAssetIndex = 4;
    const weETHInfo = await comet.getAssetInfoByAddress(WEETH_ADDRESS);
    expect(weETHInfo.offset).to.be.eq(weETHAssetIndex);
    expect(weETHInfo.asset).to.be.eq(WEETH_ADDRESS);
    expect(weETHInfo.priceFeed).to.be.eq(WEETH_PRICE_FEED_ADDRESS);
    expect(weETHInfo.scale).to.be.eq(exp(1, PROPOSED_WEETH_ASSET_INFO.decimals));
    expect(weETHInfo.borrowCollateralFactor).to.be.eq(PROPOSED_WEETH_ASSET_INFO.borrowCollateralFactor);
    expect(weETHInfo.liquidateCollateralFactor).to.be.eq(PROPOSED_WEETH_ASSET_INFO.liquidateCollateralFactor);
    expect(weETHInfo.liquidationFactor).to.be.eq(PROPOSED_WEETH_ASSET_INFO.liquidationFactor);
    expect(weETHInfo.supplyCap).to.be.eq(PROPOSED_WEETH_ASSET_INFO.supplyCap);
  },
});
