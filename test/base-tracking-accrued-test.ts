import { ethers, expect, exp, fastForward, getBlock, makeProtocol } from './helpers';

describe('baseTrackingAccrued', function() {
  it('supply updates baseTrackingAccrued to 6 decimal value', async () => {
    const start = (await getBlock()).timestamp + 100;

    const {
      comet, tokens, users: [alice]
    } = await makeProtocol({
      base: 'USDC',
      trackingIndexScale: 1e15,
      baseTrackingSupplySpeed: 1e15, // supplySpeed=1 Comp/s
      start
    });
    const { USDC } = tokens;

    // allocate and approve transfers
    await USDC.allocateTo(alice.address, 2e6);
    await USDC.connect(alice).approve(comet.address, 2e6);

    await ethers.provider.send('evm_setAutomine', [false]);

    // supply once
    await comet.connect(alice).supply(USDC.address, 1e6);
    const firstSupplyTime = start + 100;
    await ethers.provider.send('evm_mine', [firstSupplyTime]);

    const userBasic1 = await comet.userBasic(alice.address);
    expect(userBasic1.principal).to.eq(1_000_000);
    expect(userBasic1.baseTrackingAccrued).to.eq(0);

    // supply again
    await comet.connect(alice).supply(USDC.address, 1e6);
    await ethers.provider.send('evm_mine', [firstSupplyTime + 1]);
    await ethers.provider.send('evm_setAutomine', [true]);

    const userBasic2 = await comet.userBasic(alice.address);
    expect(userBasic2.principal).to.eq(2_000_000);

    // 1 second elapsed = 1 unit of rewards accrued (for 1 unit of base)
    expect(userBasic2.baseTrackingAccrued).to.eq(1_000_000);
  });

  it('updates with precision up to 6 decimal places', async () => {
    const {
      comet, tokens, users: [alice]
    } = await makeProtocol({
      base: 'USDC',
      trackingIndexScale: 1e15,
      baseTrackingSupplySpeed: 1e9, // supplySpeed=0.000001 (1e-6) Comp/s
    });
    const { USDC } = tokens;

    // allocate and approve transfers
    await USDC.allocateTo(alice.address, 2e6);
    await USDC.connect(alice).approve(comet.address, 2e6);

    // supply once
    await comet.connect(alice).supply(USDC.address, 1e6);

    const userBasic1 = await comet.userBasic(alice.address);
    expect(userBasic1.principal).to.eq(1_000_000);
    expect(userBasic1.baseTrackingAccrued).to.eq(0);

    // supply again
    await comet.connect(alice).supply(USDC.address, 1e6);

    const userBasic2 = await comet.userBasic(alice.address);
    expect(userBasic2.principal).to.eq(2_000_000);

    // 1 second elapsed = .000001 unit of rewards accrued (for 1 unit of base)
    expect(userBasic2.baseTrackingAccrued).to.eq(1);
  });

  it('rounds down to zero for values below 6 decimal places', async () => {
    const {
      comet, tokens, users: [alice]
    } = await makeProtocol({
      base: 'USDC',
      trackingIndexScale: 1e15,
      baseTrackingSupplySpeed: 1e8, // supplySpeed=0.0000001 (1e-7) Comp/s
    });
    const { USDC } = tokens;

    // allocate and approve transfers
    await USDC.allocateTo(alice.address, 2e6);
    await USDC.connect(alice).approve(comet.address, 2e6);

    // supply once
    await comet.connect(alice).supply(USDC.address, 1e6);

    const userBasic1 = await comet.userBasic(alice.address);
    expect(userBasic1.principal).to.eq(1_000_000);
    expect(userBasic1.baseTrackingAccrued).to.eq(0);

    // supply again
    await comet.connect(alice).supply(USDC.address, 1e6);

    const userBasic2 = await comet.userBasic(alice.address);
    expect(userBasic2.principal).to.eq(2_000_000);
    expect(userBasic2.baseTrackingAccrued).to.eq(0); // 1 second elapsed = .0000001 unit of rewards accrued; rounds down to 0
  });

  it('acrrues at a greater number of decimals, but preserves 6', async () => {
    const {
      comet, tokens, users: [alice]
    } = await makeProtocol({
      base: 'USDC',
      trackingIndexScale: 1e15,
      baseTrackingSupplySpeed: 1e8, // supplySpeed=0.0000001 (1e-7) Comp/s
    });
    const { USDC } = tokens;

    // allocate and approve transfers
    await USDC.allocateTo(alice.address, 2e6);
    await USDC.connect(alice).approve(comet.address, 2e6);

    // supply once
    await comet.connect(alice).supply(USDC.address, 1e6);

    const userBasic1 = await comet.userBasic(alice.address);
    expect(userBasic1.principal).to.eq(1_000_000);
    expect(userBasic1.baseTrackingAccrued).to.eq(0);

    // allow 10 seconds to pass
    await fastForward(10);

    // supply again
    await comet.connect(alice).supply(USDC.address, 1e6);

    const userBasic2 = await comet.userBasic(alice.address);
    expect(userBasic2.principal).to.eq(2_000_000);
    expect(userBasic2.baseTrackingAccrued).to.eq(1); // 10 seconds elapsed = .000001 unit of rewards accrued
  });


  it('accrues correctly when base token has more than 6 decimals', async () => {
    const {
      comet, tokens, users: [alice]
    } = await makeProtocol({
      base: 'WETH',
      trackingIndexScale: 1e15,
      baseTrackingSupplySpeed: 1e15, // supplySpeed=1 COMP/s
    });
    const { WETH } = tokens;

    // allocate and approve transfers
    await WETH.allocateTo(alice.address, exp(2, 18));
    await WETH.connect(alice).approve(comet.address, exp(2, 18));

    // supply once
    await comet.connect(alice).supply(WETH.address, exp(1, 18));

    const userBasic1 = await comet.userBasic(alice.address);
    expect(userBasic1.principal).to.eq(exp(1,18));
    expect(userBasic1.baseTrackingAccrued).to.eq(0);

    // supply again
    await comet.connect(alice).supply(WETH.address, exp(1, 18));

    const userBasic2 = await comet.userBasic(alice.address);
    expect(userBasic2.principal).to.eq(exp(2,18));

    // 1 second elapsed = 1 unit of rewards accrued (for 1 unit of base)
    expect(userBasic2.baseTrackingAccrued).to.eq(1_000_000);
  });

  it('increases baseTrackingAccrued on borrow', async () => {
    const start = (await getBlock()).timestamp + 100;

    const {
      comet, tokens, users: [alice]
    } = await makeProtocol({
      base: 'USDC',
      trackingIndexScale: 1e15,
      baseTrackingBorrowSpeed: 1e15, // borrowSpeed=1 Comp/s per unit of borrowed base
      baseMinForRewards: exp(.5, 6),
      start
    });
    const { USDC, WETH } = tokens;

    // allocate and approve transfers
    await WETH.allocateTo(alice.address, exp(1,18));
    await WETH.connect(alice).approve(comet.address, exp(1,18));

    await USDC.allocateTo(comet.address, 2e6); // for two withdrawls of 1e6

    // supply WETH as collateral
    await comet.connect(alice).supply(WETH.address, exp(1,18));

    const userBasic1 = await comet.userBasic(alice.address);
    expect(userBasic1.principal).to.eq(0);
    expect(userBasic1.baseTrackingAccrued).to.eq(0);

    await ethers.provider.send('evm_setAutomine', [false]);

    // withdraw base token
    await comet.connect(alice).withdraw(USDC.address, 1e6);
    const firstWithdrawTime = start + 100;
    await ethers.provider.send('evm_mine', [firstWithdrawTime]);

    const userBasic2 = await comet.userBasic(alice.address);
    expect(userBasic2.principal).to.eq(-1e6);
    expect(userBasic2.baseTrackingAccrued).to.eq(0);

    // withdraw again
    await comet.connect(alice).withdraw(USDC.address, 1e6);
    await ethers.provider.send('evm_mine', [firstWithdrawTime + 1]);
    await ethers.provider.send('evm_setAutomine', [true]);

    const userBasic3 = await comet.userBasic(alice.address);
    expect(userBasic3.principal).to.eq(-2e6);

    // 1 second elapsed = 1 unit of rewards accrued
    expect(userBasic3.baseTrackingAccrued).to.eq(1e6);
  });
});