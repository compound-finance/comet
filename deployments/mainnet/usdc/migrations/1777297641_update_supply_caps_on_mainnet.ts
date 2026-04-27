import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { BigNumber, Contract } from 'ethers';

const USDT_COMET = '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840';
const USDS_COMET = '0x5D409e56D886231aDAf00c8775665AD0f9897b56';
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
      comet,
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
      // 19. Update weETH supply cap on USDT Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDT_COMET, weETH, 0],
      },
      // 20. Update mETH supply cap on USDT Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDT_COMET, mETH, 0],
      },
      // 21. Update tBTC supply cap on USDT Comet to 73
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDT_COMET, tBTC, exp(73, 18)],
      },
      // 22. Update sFRAX supply cap on USDT Comet to 33M
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDT_COMET, sFRAX, exp(33_000_000, 18)],
      },
      // 23. Update UNI supply cap on USDT Comet to 310,336
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDT_COMET, UNI, exp(310_336, 18)],
      },
      // 24. Update LINK supply cap on USDT Comet to 210,317
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDT_COMET, LINK, exp(210_317, 18)],
      },
      // 25. Deploy and upgrade the USDT Comet implementation to apply the updates
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDT_COMET],
      },
      // 26. Update weETH supply cap on USDS Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDS_COMET, weETH, 0],
      },
      // 27. Update tBTC supply cap on USDS Comet to 0
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [USDS_COMET, tBTC, 0],
      },
      // 28. Deploy and upgrade the USDS Comet implementation to apply the updates
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDS_COMET],
      },
      // 29. Update tBTC supply cap on USDC Comet to 40
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [comet.address, tBTC, exp(40, 18)],
      },
      // 30. Update UNI supply cap on USDC Comet to 364,691
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [comet.address, UNI, exp(364_691, 18)],
      },
      // 31. Update LINK supply cap on USDC Comet to 585,990
      {
        contract: configurator,
        signature: 'updateAssetSupplyCap(address,address,uint128)',
        args: [comet.address, LINK, exp(585_990, 18)],
      },
      // 32. Deploy and upgrade the USDC Comet implementation to apply the updates
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = `# Ethereum Supply Cap Recommendations: Supply cap Reduction Across Comets
### Simple Summary

Gauntlet recommends reducing supply caps on **27 collateral assets** across Compound v3's Ethereum Comets (wstETH, WETH, WBTC, USDT, USDS, USDC). In the current environment, where the frequency and sophistication of attack vectors targeting DeFi collaterals has materially increased, we are moving to a defensive posture: **14 assets with negligible demand are being set to a cap of 0**, and **13 assets with active user demand are being resized to a tight buffer above current supply balances**. Key collateral assets (WBTC, WETH, cbBTC, cbETH, USDC, USDT) are **not impacted** by this proposal.

## Background
Compound v3 supply caps govern the maximum amount of each collateral asset that can be deposited into a given Comet. They are the first line of defense against asset-specific risk oracle manipulation, depeg events, bridge failures, validator slashing, and smart-contract exploits in the underlying asset. A cap that is materially larger than actual demand is not "spare capacity"; it is risk to the protocol.

Over the last several weeks, the frequency of exploits and exploits targeting long-tail collaterals (LST/LRT depegs, wrapped-asset bridge issues, oracle edge cases) has risen sharply. In this environment, the asymmetry between the upside of holding excess headroom (new deposits we are not forecasting) and the downside (a single asset-level incident drawing on the full cap) is unfavourable. This recommendation operationalizes a risk-off stance across Ethereum Comets and will use a similar methodology for subsequent recommendations for other chains as well

## Methodology
We applied three rules, uniformly, to every collateral in scope:

1. **Rule 1 - If supply balance is zero and there are no identifiable sources of demand, set supply cap to 0.** Any collateral with **less than 1% supply utilization** (supply balance ÷ current cap) is assumed to have no organic demand in the present environment. Continuing to list capacity we do not expect to be consumed adds risk without a corresponding business case. These caps are reduced to 0.

2. **Rule 2 - Active non-key collateral assets → tight buffer**. For collaterals with some user demand, we resize the cap to sit **~20–30% above current supply balance**. This preserves headroom for existing borrowers to top up collateral during volatility (avoiding liquidations at the margin) while sharply reducing exposure.

3. **Rule 3 - Key collateral assets (WBTC, WETH, cbBTC, cbETH, USDC, USDT) → no change.** These assets carry materially lower idiosyncratic risk, have deep liquidity, and are the primary drivers of organic borrow demand. They are not part of this proposal.

An aggregate view:
| Bucket | Assets | Action |
|---|---|---|
| Rule 1: Utilization < 1% | 14 | Cap → 0 |
| Rule 2: Active non-key collateral assets | 13 | Cap resized to ~20–30% above supply |
| Rule 3: Key collateral assets | 0 | Unchanged |

## Detailed Recommendations
### Ethereum wstETH Comet
| Symbol | Current Cap | Supply Balance | Utilization | Proposed Cap | Rule |
|---|---|---|---|---|---|
| weETH | 5,000 | 0 | 0.00% | 0 | Rule 1 |
| ezETH | 7,500 | 0 | 0.01% | 0 | Rule 1 |
| tETH | 2,500 | 34 | 1.37% | 44 | Rule 2 (~29% buffer) |

### Ethereum WETH Comet
| Symbol | Current Cap | Supply Balance | Utilization | Proposed Cap | Rule |
|---|---|---|---|---|---|
| wOETH | 5,000 | 4 | 0.08% | 0 | Rule 1 |
| tBTC | 157 | 0 | 0.01% | 0 | Rule 1 |
| rswETH | 500 | 0 | 0.10% | 0 | Rule 1 |
| rETH | 15,000 | 30 | 0.20% | 0 | Rule 1 |
| osETH | 2,500 | 1 | 0.04% | 0 | Rule 1 |
| ETHx | 1,050 | 0 | 0.02% | 0 | Rule 1 |
| weETH | 67,500 | 2,969 | 4.40% | 3,860 | Rule 2 (~30% buffer) |
| tETH | 5,000 | 1,288 | 25.76% | 1,545 | Rule 2 (~20% buffer) |
| pufETH | 2,250 | 81 | 3.61% | 105 | Rule 2 (~30% buffer) |
| ezETH | 80,000 | 25,510 | 31.89% | 33,163 | Rule 2 (~30% buffer) |

This is the most structurally impacted Comet. The WETH market currently carries 10 collateral listings, of which only four (weETH, tETH, pufETH, ezETH) are absorbing material deposits. The remaining six (wOETH, tBTC, rswETH, rETH, osETH, ETHx) together hold ~35 WETH of supply against a ~28,707 WETH aggregate cap, effectively zero demand against exposure.

### Ethereum WBTC Comet
| Symbol | Current Cap | Supply Balance | Utilization | Proposed Cap | Rule |
|---|---|---|---|---|---|
| pumpBTC | 15 | 0 | 0.00% | 0 | Rule 1 |
| LBTC | 200 | 0 | 0.00% | 0 | Rule 1 |

Both long-tail BTC derivatives in this Comet currently hold zero supply. Caps reduced to 0.

### Ethereum USDT Comet
| Symbol | Current Cap | Supply Balance | Utilization | Proposed Cap | Rule |
|---|---|---|---|---|---|
| weETH | 25,000 | 11 | 0.04% | 0 | Rule 1 |
| mETH | 2,000 | 5 | 0.27% | 0 | Rule 1 |
| tBTC | 360 | 56 | 15.66% | 73 | Rule 2 (~30% buffer) |
| sFRAX | 50,000,000 | 32,550,978 | 65.10% | 33,000,000 | Rule 2 (see note) |
| UNI | 1,300,000 | 238,720 | 18.36% | 310,336 | Rule 2 (~30% buffer) |
| LINK | 1,000,000 | 161,782 | 16.18% | 210,317 | Rule 2 (~30% buffer) |

**Note on sFRAX**: sFRAX is at ~65% utilization against its current cap, materially higher than the other Rule 2 assets. In absolute terms, a 30% buffer would imply a cap of ~42.3M, but given (a) the already-elevated utilization, (b) the size of the outstanding balance, and © the intentionally conservative posture of this proposal, we are initially sizing the cap at 33M (~1.4% buffer above current supply). We will monitor supply dynamics closely and bring a follow-up recommendation if organic growth warrants additional headroom.

### Ethereum USDS Comet
| Symbol | Current Cap | Supply Balance | Utilization | Proposed Cap | Rule |
|---|---|---|---|---|---|
| weETH | 6,000 | 0 | 0.00% | 0 | Rule 1 |
| tBTC | 142 | 1 | 0.56% | 0 | Rule 1 |

Both collaterals sit below the 1% utilization threshold. Caps reduced to 0.

### Ethereum USDC Comet
| Symbol | Current Cap | Supply Balance | Utilization | Proposed Cap | Rule |
|---|---|---|---|---|---|
| tBTC | 570 | 30 | 5.35% | 40 | Rule 2 (~33% buffer) |
| UNI | 2,600,000 | 280,532 | 10.79% | 364,691 | Rule 2 (~30% buffer) |
| LINK | 2,000,000 | 450,761 | 22.54% | 585,990 | Rule 2 (~30% buffer) |

## Expected Outcomes

* **Existing users are not displaced.** Every Rule 2 cap is set above the current supply balance. No user will be forced to withdraw, and all have room to top up collateral to avoid liquidations during drawdowns.

* **New incremental deposits into dormant collaterals are paused.** Assets set to 0 remain fully functional for existing positions (withdraw, repay, liquidate) but cannot absorb new supply until a future governance action reopens them.

* **Protocol risk is compressed.** The aggregate cap reduction across Comets changes the strategy from trying to grow borrow demand to sustaining existing users.

* **Borrow-side UX for key collateral activity is unaffected**, since key collateral assets and base assets are untouched.

## Risk Considerations

* **Foregone demand:** If a currently dormant asset experiences a demand surge (e.g., a narrative shift), new deposits would be capped. We view this as an acceptable trade-off given current conditions and note that caps can be raised through routine governance as demand materializes.

* **Cap-reopening latency:** Standard Compound governance timing applies. If an asset needs to be reopened, it will take the usual proposal cycle.

* **No change to LTV, liquidation thresholds, or borrow caps** is proposed in this post. This is a supply-cap-only action.
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

    // 19 - 25 Compare updated assets on USDT Comet
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

    // 26 - 28 Compare updated assets on USDS Comet
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

    // 29 - 32 Compare updated assets on USDC Comet
    const { comet: cometUSDC } = await deploymentManager.getContracts();

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
