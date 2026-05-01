import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { BigNumber, Contract } from 'ethers';

const USDC_COMET = '0xc3d688B66703497DAA19211EEdff47f25384cdc3';
const USDT_COMET = '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840';
const USDS_COMET = '0x5D409e56D886231aDAf00c8775665AD0f9897b56';

const weETH = '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee';
const tBTC = '0x18084fbA666a33d37592fA2633fD49a74DD93a88';
const mETH = '0xd5f7838f5c461feff7fe49ea5ebaf7728bb0adfa';
const sFRAX = '0xa663b02cf0a4b149d2ad41910cb81e23e1c41c32';
const UNI = '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984';
const LINK = '0x514910771af9ca656af840dff83e8264ecf986ca';

export default migration('1777297641_update_supply_caps_on_mainnet', {
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
      // 1. Update weETH supply cap on USDT Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDT_COMET, weETH, 0],
      },
      // 2. Update mETH supply cap on USDT Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDT_COMET, mETH, 0],
      },
      // 3. Update tBTC supply cap on USDT Comet to 73
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDT_COMET, tBTC, exp(73, 18)],
      },
      // 4. Update sFRAX supply cap on USDT Comet to 33M
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDT_COMET, sFRAX, exp(33_000_000, 18)],
      },
      // 5. Update UNI supply cap on USDT Comet to 310,336
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDT_COMET, UNI, exp(310_336, 18)],
      },
      // 6. Update LINK supply cap on USDT Comet to 210,317
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDT_COMET, LINK, exp(210_317, 18)],
      },
      // 7. Deploy and upgrade the USDT Comet implementation to apply the updates
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDT_COMET],
      },
      // 8. Update weETH supply cap on USDS Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDS_COMET, weETH, 0],
      },
      // 9. Update tBTC supply cap on USDS Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDS_COMET, tBTC, 0],
      },
      // 10. Deploy and upgrade the USDS Comet implementation to apply the updates
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDS_COMET],
      },
      // 11. Update tBTC supply cap on USDC Comet to 40
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDC_COMET, tBTC, exp(40, 18)],
      },
      // 12. Update UNI supply cap on USDC Comet to 364,691
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDC_COMET, UNI, exp(364_691, 18)],
      },
      // 13. Update LINK supply cap on USDC Comet to 585,990
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDC_COMET, LINK, exp(585_990, 18)],
      },
      // 14. Deploy and upgrade the USDC Comet implementation to apply the updates
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDC_COMET],
      },
    ];

    const description = `# Ethereum Supply cap Reduction Across USD Based Comets

## Proposal summary

This proposal updates supply caps for a number of assets across the USD based Mainnet markets. The supply caps for the affected assets are being updated based on their current utilization and risk parameters.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1115) and [forum discussion](https://www.comp.xyz/t/ethereum-supply-cap-reduction-across-comets/7793).

## Proposal actions


1 - 7. Updates supply caps for weETH and mETH to 0 and tBTC to 73, sFRAX to 33M, UNI to 310,336, and LINK to 210,317 on cUSDTv3 market and upgrades the Comet implementation to apply the changes.

8 - 10. Updates supply caps for weETH and tBTC to 0 on cUSDSv3 market and upgrades the Comet implementation to apply the changes.

11 - 14. Updates supply caps for tBTC to 40, UNI to 364,691, and LINK to 585,990 on cUSDCv3 market and upgrades the Comet implementation to apply the changes.
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

    // 1 - 7 Compare updated assets on USDT Comet
    const cometUSDT = new Contract(
      USDT_COMET,
      [
        'function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'
      ],
      await deploymentManager.getSigner()
    );

    const assetInfoForWeETHOnUSDTInComet = await cometUSDT.getAssetInfoByAddress(weETH);
    expect(assetInfoForWeETHOnUSDTInComet.supplyCap).to.equal(0);

    const assetInfoForMETHOnUSDTInComet = await cometUSDT.getAssetInfoByAddress(mETH);
    expect(assetInfoForMETHOnUSDTInComet.supplyCap).to.equal(0);

    const assetInfoForTBTCOnUSDTInComet = await cometUSDT.getAssetInfoByAddress(tBTC);
    expect(assetInfoForTBTCOnUSDTInComet.supplyCap).to.equal(BigNumber.from(73).mul(assetInfoForTBTCOnUSDTInComet.scale));

    const assetInfoForSFRAXOnUSDTInComet = await cometUSDT.getAssetInfoByAddress(sFRAX);
    expect(assetInfoForSFRAXOnUSDTInComet.supplyCap).to.equal(BigNumber.from(33_000_000).mul(assetInfoForSFRAXOnUSDTInComet.scale));

    const assetInfoForUNIOnUSDTInComet = await cometUSDT.getAssetInfoByAddress(UNI);
    expect(assetInfoForUNIOnUSDTInComet.supplyCap).to.equal(BigNumber.from(310_336).mul(assetInfoForUNIOnUSDTInComet.scale));

    const assetInfoForLINKOnUSDTInComet = await cometUSDT.getAssetInfoByAddress(LINK);
    expect(assetInfoForLINKOnUSDTInComet.supplyCap).to.equal(BigNumber.from(210_317).mul(assetInfoForLINKOnUSDTInComet.scale));

    const USDTConfiguration = await configurator.getConfiguration(USDT_COMET);
    expect(USDTConfiguration.assetConfigs[assetInfoForWeETHOnUSDTInComet.offset].supplyCap).to.equal(0);
    expect(USDTConfiguration.assetConfigs[assetInfoForMETHOnUSDTInComet.offset].supplyCap).to.equal(0);
    expect(USDTConfiguration.assetConfigs[assetInfoForTBTCOnUSDTInComet.offset].supplyCap).to.equal(BigNumber.from(73).mul(assetInfoForTBTCOnUSDTInComet.scale));
    expect(USDTConfiguration.assetConfigs[assetInfoForSFRAXOnUSDTInComet.offset].supplyCap).to.equal(BigNumber.from(33_000_000).mul(assetInfoForSFRAXOnUSDTInComet.scale));
    expect(USDTConfiguration.assetConfigs[assetInfoForUNIOnUSDTInComet.offset].supplyCap).to.equal(BigNumber.from(310_336).mul(assetInfoForUNIOnUSDTInComet.scale));
    expect(USDTConfiguration.assetConfigs[assetInfoForLINKOnUSDTInComet.offset].supplyCap).to.equal(BigNumber.from(210_317).mul(assetInfoForLINKOnUSDTInComet.scale));

    // 8 - 10 Compare updated assets on USDS Comet
    const cometUSDS = new Contract(
      USDS_COMET,
      [
        'function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'
      ],
      await deploymentManager.getSigner()
    );

    const assetInfoForWeETHOnUSDSInComet = await cometUSDS.getAssetInfoByAddress(weETH);
    expect(assetInfoForWeETHOnUSDSInComet.supplyCap).to.equal(0);

    const assetInfoForTBTCOnUSDSInComet = await cometUSDS.getAssetInfoByAddress(tBTC);
    expect(assetInfoForTBTCOnUSDSInComet.supplyCap).to.equal(0);

    const USDSConfiguration = await configurator.getConfiguration(USDS_COMET);
    expect(USDSConfiguration.assetConfigs[assetInfoForWeETHOnUSDSInComet.offset].supplyCap).to.equal(0);
    expect(USDSConfiguration.assetConfigs[assetInfoForTBTCOnUSDSInComet.offset].supplyCap).to.equal(0);

    // 11 - 14 Compare updated assets on USDC Comet
    const cometUSDC = new Contract(
      USDC_COMET,
      [
        'function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))'
      ],
      await deploymentManager.getSigner()
    );

    const assetInfoForTBTCOnUSDCInComet = await cometUSDC.getAssetInfoByAddress(tBTC);
    expect(assetInfoForTBTCOnUSDCInComet.supplyCap).to.equal(BigNumber.from(40).mul(assetInfoForTBTCOnUSDCInComet.scale));

    const assetInfoForUNIOnUSDCInComet = await cometUSDC.getAssetInfoByAddress(UNI);
    expect(assetInfoForUNIOnUSDCInComet.supplyCap).to.equal(BigNumber.from(364_691).mul(assetInfoForUNIOnUSDCInComet.scale));

    const assetInfoForLINKOnUSDCInComet = await cometUSDC.getAssetInfoByAddress(LINK);
    expect(assetInfoForLINKOnUSDCInComet.supplyCap).to.equal(BigNumber.from(585_990).mul(assetInfoForLINKOnUSDCInComet.scale));

    const USDCConfiguration = await configurator.getConfiguration(cometUSDC.address);
    expect(USDCConfiguration.assetConfigs[assetInfoForTBTCOnUSDCInComet.offset].supplyCap).to.equal(BigNumber.from(40).mul(assetInfoForTBTCOnUSDCInComet.scale));
    expect(USDCConfiguration.assetConfigs[assetInfoForUNIOnUSDCInComet.offset].supplyCap).to.equal(BigNumber.from(364_691).mul(assetInfoForUNIOnUSDCInComet.scale));
    expect(USDCConfiguration.assetConfigs[assetInfoForLINKOnUSDCInComet.offset].supplyCap).to.equal(BigNumber.from(585_990).mul(assetInfoForLINKOnUSDCInComet.scale));
  },
});
