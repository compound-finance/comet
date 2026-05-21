import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { BigNumber, Contract } from 'ethers';

const WBTC_COMET = '0xe85Dc543813B8c2CFEaAc371517b925a166a9293';
const WETH_COMET = '0xA17581A9E3356d9A858b789D68B4d866e593aE94';
const WSTETH_COMET = '0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3';

const weETH = '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee';
const ezETH = '0xbf5495Efe5DB9ce00f80364C8B423567e58d2110';
const tETH = '0xd11c452fc99cf405034ee446803b6f6c1f6d5ed8';
const wOETH = '0xdcee70654261af21c44c093c300ed3bb97b78192';
const tBTC = '0x18084fbA666a33d37592fA2633fD49a74DD93a88';
const rswETH = '0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0';
const rETH = '0xae78736cd615f374d3085123a210448e74fc6393';
const osETH = '0xf1c9acdc66974dfb6decb12aa385b9cd01190e38';
const ETHx = '0xA35b1B31Ce002FBF2058D22F30f95D405200A15b';
const pufETH = '0xd9a442856c234a39a81a089c06451ebaa4306a72';
const pumpBTC = '0xf469fbd2abcd6b9de8e169d128226c0fc90a012e';
const LBTC = '0x8236a87084f8b84306f72007f36f2618a5634494';

export default migration('1777625885_update_supply_caps_on_mainnet', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {

    const trace = deploymentManager.tracer();

    const {
      governor,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const mainnetActions = [
      // 1. Update weETH supply cap on wstETH Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [WSTETH_COMET, weETH, 0],
      },
      // 2. Update ezETH supply cap on wstETH Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [WSTETH_COMET, ezETH, 0],
      },
      // 3. Update tETH supply cap on wstETH Comet to 44
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [WSTETH_COMET, tETH, exp(44, 18)],
      },
      // 4. Deploy and upgrade the wstETH Comet implementation to apply the updates
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, WSTETH_COMET],
      },
      // 5. Update wOETH supply cap on WETH Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [WETH_COMET, wOETH, 0],
      },
      // 6. Update tBTC supply cap on WETH Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [WETH_COMET, tBTC, 0],
      },
      // 7. Update rswETH supply cap on WETH Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [WETH_COMET, rswETH, 0],
      },
      // 8. Update rETH supply cap on WETH Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [WETH_COMET, rETH, 0],
      },
      // 9. Update osETH supply cap on WETH Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [WETH_COMET, osETH, 0],
      },
      // 10. Update ETHx supply cap on WETH Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [WETH_COMET, ETHx, 0],
      },
      // 11. Update weETH supply cap on WETH Comet to 3,860
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [WETH_COMET, weETH, exp(3860, 18)],
      },
      // 12. Update tETH supply cap on WETH Comet to 1,545
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [WETH_COMET, tETH, exp(1545, 18)],
      },
      // 13. Update pufETH supply cap on WETH Comet to 105
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [WETH_COMET, pufETH, exp(105, 18)],
      },
      // 14. Update ezETH supply cap on WETH Comet to 33,163
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [WETH_COMET, ezETH, exp(33163, 18)],
      },
      // 15. Deploy and upgrade the WETH Comet implementation to apply the updates
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, WETH_COMET],
      },
      // 16. Update pumpBTC supply cap on WBTC Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [WBTC_COMET, pumpBTC, 0],
      },
      // 17. Update LBTC supply cap on WBTC Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [WBTC_COMET, LBTC, 0],
      },
      // 18. Deploy and upgrade the WBTC Comet implementation to apply the updates
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, WBTC_COMET],
      },
    ];

    const description = `# Ethereum Supply cap Reduction Across Non-USD Based Comets

## Proposal summary

This proposal updates supply caps for a number of assets across the non-usd based Mainnet markets. The supply caps for the affected assets are being updated based on their current utilization and risk parameters.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1116) and [forum discussion](https://www.comp.xyz/t/ethereum-supply-cap-reduction-across-comets/7793).

## Proposal actions

1 - 4. Updates supply caps for weETH and ezETH to 0 and tETH to 44 on cWstETHv3 market and upgrades the Comet implementation to apply the changes.

5 - 15. Updates supply caps for wOETH, tBTC, rswETH, rETH, osETH, and ETHx to 0 and weETH to 3,860, tETH to 1,545, pufETH to 105, and ezETH to 33,163 on cWETHv3 market and upgrades the Comet implementation to apply the changes.

16 - 18. Updates supply caps for pumpBTC and LBTC to 0 on cWBTCv3 market and upgrades the Comet implementation to apply the changes.
`;
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      ), 0, 600_000
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
    const { configurator } = await deploymentManager.getContracts();

    // 1 - 4 Compare updated assets on wstETH Comet
    const cometWstETH = new Contract(
      WSTETH_COMET,
      [
        'function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'
      ],
      await deploymentManager.getSigner()
    );

    const assetInfoForWeETHOnWstETHInComet = await cometWstETH.getAssetInfoByAddress(weETH);
    expect(assetInfoForWeETHOnWstETHInComet.supplyCap).to.equal(0);

    const assetInfoForEzETHOnWstETHInComet = await cometWstETH.getAssetInfoByAddress(ezETH);
    expect(assetInfoForEzETHOnWstETHInComet.supplyCap).to.equal(0);

    const assetInfoForTETHOnWstETHInComet = await cometWstETH.getAssetInfoByAddress(tETH);
    expect(assetInfoForTETHOnWstETHInComet.supplyCap).to.equal(BigNumber.from(44).mul(assetInfoForTETHOnWstETHInComet.scale));

    const wstETHConfiguration = await configurator.getConfiguration(WSTETH_COMET);
    expect(wstETHConfiguration.assetConfigs[assetInfoForWeETHOnWstETHInComet.offset].supplyCap).to.equal(0);
    expect(wstETHConfiguration.assetConfigs[assetInfoForEzETHOnWstETHInComet.offset].supplyCap).to.equal(0);
    expect(wstETHConfiguration.assetConfigs[assetInfoForTETHOnWstETHInComet.offset].supplyCap).to.equal(BigNumber.from(44).mul(assetInfoForTETHOnWstETHInComet.scale));

    // 5 - 15 Compare updated assets on WETH Comet
    const cometWETH = new Contract(
      WETH_COMET,
      [
        'function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'
      ],
      await deploymentManager.getSigner()
    );

    const assetInfoForWOETHOnWETHInComet = await cometWETH.getAssetInfoByAddress(wOETH);
    expect(assetInfoForWOETHOnWETHInComet.supplyCap).to.equal(0);

    const assetInfoForTBTCOnWETHInComet = await cometWETH.getAssetInfoByAddress(tBTC);
    expect(assetInfoForTBTCOnWETHInComet.supplyCap).to.equal(0);

    const assetInfoForRswETHOnWETHInComet = await cometWETH.getAssetInfoByAddress(rswETH);
    expect(assetInfoForRswETHOnWETHInComet.supplyCap).to.equal(0);

    const assetInfoForRETHOnWETHInComet = await cometWETH.getAssetInfoByAddress(rETH);
    expect(assetInfoForRETHOnWETHInComet.supplyCap).to.equal(0);

    const assetInfoForOsETHOnWETHInComet = await cometWETH.getAssetInfoByAddress(osETH);
    expect(assetInfoForOsETHOnWETHInComet.supplyCap).to.equal(0);

    const assetInfoForETHxOnWETHInComet = await cometWETH.getAssetInfoByAddress(ETHx);
    expect(assetInfoForETHxOnWETHInComet.supplyCap).to.equal(0);

    const assetInfoForWeETHOnWETHInComet = await cometWETH.getAssetInfoByAddress(weETH);
    expect(assetInfoForWeETHOnWETHInComet.supplyCap).to.equal(BigNumber.from(3860).mul(assetInfoForWeETHOnWETHInComet.scale));

    const assetInfoForTETHOnWETHInComet = await cometWETH.getAssetInfoByAddress(tETH);
    expect(assetInfoForTETHOnWETHInComet.supplyCap).to.equal(BigNumber.from(1545).mul(assetInfoForTETHOnWETHInComet.scale));

    const assetInfoForPufETHOnWETHInComet = await cometWETH.getAssetInfoByAddress(pufETH);
    expect(assetInfoForPufETHOnWETHInComet.supplyCap).to.equal(BigNumber.from(105).mul(assetInfoForPufETHOnWETHInComet.scale));

    const assetInfoForEzETHOnWETHInComet = await cometWETH.getAssetInfoByAddress(ezETH);
    expect(assetInfoForEzETHOnWETHInComet.supplyCap).to.equal(BigNumber.from(33163).mul(assetInfoForEzETHOnWETHInComet.scale));

    const WETHConfiguration = await configurator.getConfiguration(WETH_COMET);
    expect(WETHConfiguration.assetConfigs[assetInfoForWOETHOnWETHInComet.offset].supplyCap).to.equal(0);
    expect(WETHConfiguration.assetConfigs[assetInfoForTBTCOnWETHInComet.offset].supplyCap).to.equal(0);
    expect(WETHConfiguration.assetConfigs[assetInfoForRswETHOnWETHInComet.offset].supplyCap).to.equal(0);
    expect(WETHConfiguration.assetConfigs[assetInfoForRETHOnWETHInComet.offset].supplyCap).to.equal(0);
    expect(WETHConfiguration.assetConfigs[assetInfoForOsETHOnWETHInComet.offset].supplyCap).to.equal(0);
    expect(WETHConfiguration.assetConfigs[assetInfoForETHxOnWETHInComet.offset].supplyCap).to.equal(0);
    expect(WETHConfiguration.assetConfigs[assetInfoForWeETHOnWETHInComet.offset].supplyCap).to.equal(BigNumber.from(3860).mul(assetInfoForWeETHOnWETHInComet.scale));
    expect(WETHConfiguration.assetConfigs[assetInfoForTETHOnWETHInComet.offset].supplyCap).to.equal(BigNumber.from(1545).mul(assetInfoForTETHOnWETHInComet.scale));
    expect(WETHConfiguration.assetConfigs[assetInfoForPufETHOnWETHInComet.offset].supplyCap).to.equal(BigNumber.from(105).mul(assetInfoForPufETHOnWETHInComet.scale));
    expect(WETHConfiguration.assetConfigs[assetInfoForEzETHOnWETHInComet.offset].supplyCap).to.equal(BigNumber.from(33163).mul(assetInfoForEzETHOnWETHInComet.scale));

    // 16 - 18 Compare updated assets on WBTC Comet
    const cometWBTC = new Contract(
      WBTC_COMET,
      [
        'function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'
      ],
      await deploymentManager.getSigner()
    );

    const assetInfoForPumpBTCOnWBTCInComet = await cometWBTC.getAssetInfoByAddress(pumpBTC);
    expect(assetInfoForPumpBTCOnWBTCInComet.supplyCap).to.equal(0);

    const assetInfoForLBTCOnWBTCInComet = await cometWBTC.getAssetInfoByAddress(LBTC);
    expect(assetInfoForLBTCOnWBTCInComet.supplyCap).to.equal(0);

    const WBTCConfiguration = await configurator.getConfiguration(WBTC_COMET);
    expect(WBTCConfiguration.assetConfigs[assetInfoForPumpBTCOnWBTCInComet.offset].supplyCap).to.equal(0);
    expect(WBTCConfiguration.assetConfigs[assetInfoForLBTCOnWBTCInComet.offset].supplyCap).to.equal(0);
  },
});
