import { baseBalanceOf, ethers, expect, exp, makeProtocol, wait, makeBulker, defaultAssets, getGasUsed, makeRewards, fastForward } from './helpers';
import { FaucetWETH__factory } from '../build/types';

// XXX Improve the "no permission" tests that should expect a custom error when
// when https://github.com/nomiclabs/hardhat/issues/1618 gets fixed.
describe('bulker', function () {
  it('supply base asset', async () => {
    const protocol = await makeProtocol({});
    const { comet, tokens: { USDC, WETH }, users: [alice] } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    // Alice approves 10 USDC to Comet
    const supplyAmount = exp(10, 6);
    await USDC.allocateTo(alice.address, supplyAmount);
    await USDC.connect(alice).approve(comet.address, ethers.constants.MaxUint256);

    // Alice gives the Bulker permission over her account
    await comet.connect(alice).allow(bulker.address, true);

    // Alice supplies 10 USDC through the bulker
    const supplyAssetCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, alice.address, USDC.address, supplyAmount]);
    await bulker.connect(alice).invoke([await bulker.ACTION_SUPPLY_ASSET()], [supplyAssetCalldata]);

    expect(await baseBalanceOf(comet, alice.address)).to.be.equal(supplyAmount);
  });

  it('supply collateral asset', async () => {
    const protocol = await makeProtocol({});
    const { comet, tokens: { COMP, WETH }, users: [alice] } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    // Alice approves 10 COMP to Comet
    const supplyAmount = exp(10, 18);
    await COMP.allocateTo(alice.address, supplyAmount);
    await COMP.connect(alice).approve(comet.address, ethers.constants.MaxUint256);

    // Alice gives the Bulker permission over her account
    await comet.connect(alice).allow(bulker.address, true);

    // Alice supplies 10 COMP through the bulker
    const supplyAssetCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, alice.address, COMP.address, supplyAmount]);
    await bulker.connect(alice).invoke([await bulker.ACTION_SUPPLY_ASSET()], [supplyAssetCalldata]);

    expect(await comet.collateralBalanceOf(alice.address, COMP.address)).to.be.equal(supplyAmount);
  });

  it('supply collateral asset to a different account', async () => {
    const protocol = await makeProtocol({});
    const { comet, tokens: { COMP, WETH }, users: [alice, bob] } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    // Alice approves 10 COMP to Comet
    const supplyAmount = exp(10, 18);
    await COMP.allocateTo(alice.address, supplyAmount);
    await COMP.connect(alice).approve(comet.address, ethers.constants.MaxUint256);

    // Alice gives the Bulker permission over her account
    await comet.connect(alice).allow(bulker.address, true);

    // Alice supplies 10 COMP to Bob through the bulker
    const supplyAssetCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, bob.address, COMP.address, supplyAmount]);
    await bulker.connect(alice).invoke([await bulker.ACTION_SUPPLY_ASSET()], [supplyAssetCalldata]);

    expect(await comet.collateralBalanceOf(alice.address, COMP.address)).to.be.equal(0);
    expect(await comet.collateralBalanceOf(bob.address, COMP.address)).to.be.equal(supplyAmount);
  });

  it('supply ETH', async () => {
    const protocol = await makeProtocol({
      assets: defaultAssets({}, {
        WETH: { factory: await ethers.getContractFactory('FaucetWETH') as FaucetWETH__factory }
      })
    });
    const { comet, tokens: { WETH }, users: [alice] } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    // No approval is actually needed on the supplyEth action!

    // Alice supplies 10 ETH through the bulker
    const supplyAmount = exp(10, 18);
    const supplyEthCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [comet.address, alice.address, supplyAmount]);
    await bulker.connect(alice).invoke([await bulker.ACTION_SUPPLY_ETH()], [supplyEthCalldata], { value: supplyAmount });

    expect(await comet.collateralBalanceOf(alice.address, WETH.address)).to.be.equal(supplyAmount);
  });

  it('supply ETH refunds unused ETH', async () => {
    const protocol = await makeProtocol({
      assets: defaultAssets({}, {
        WETH: { factory: await ethers.getContractFactory('FaucetWETH') as FaucetWETH__factory }
      })
    });
    const { comet, tokens: { WETH }, users: [alice] } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    // No approval is actually needed on the supplyEth action!

    // Alice supplies 10 ETH through the bulker but actually sends 20 ETH
    const aliceBalanceBefore = await alice.getBalance();
    const supplyAmount = exp(10, 18);
    const supplyEthCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [comet.address, alice.address, supplyAmount]);
    const txn = await wait(bulker.connect(alice).invoke([await bulker.ACTION_SUPPLY_ETH()], [supplyEthCalldata], { value: supplyAmount * 2n }));
    const aliceBalanceAfter = await alice.getBalance();

    expect(await comet.collateralBalanceOf(alice.address, WETH.address)).to.be.equal(supplyAmount);
    expect(aliceBalanceBefore.sub(aliceBalanceAfter)).to.be.equal(supplyAmount + getGasUsed(txn));
  });

  it('supply ETH with insufficient ETH', async () => {
    const protocol = await makeProtocol({
      assets: defaultAssets({}, {
        WETH: { factory: await ethers.getContractFactory('FaucetWETH') as FaucetWETH__factory }
      })
    });
    const { comet, tokens: { WETH }, users: [alice] } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    // No approval is actually needed on the supplyEth action!

    // Alice supplies 10 ETH through the bulker but only sends 5 ETH
    const supplyAmount = exp(10, 18);
    const supplyEthCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [comet.address, alice.address, supplyAmount]);
    await expect(bulker.connect(alice).invoke([await bulker.ACTION_SUPPLY_ETH()], [supplyEthCalldata], { value: supplyAmount / 2n }))
      .to.be.revertedWith('code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)');
  });

  it('transfer base asset', async () => {
    const protocol = await makeProtocol({});
    const { comet, tokens: { USDC, WETH }, users: [alice, bob] } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    const transferAmount = exp(10, 6);
    await comet.setBasePrincipal(alice.address, transferAmount);

    // Alice gives the Bulker permission over her account
    await comet.connect(alice).allow(bulker.address, true);

    // Alice transfer 10 USDC to Bob through the bulker
    const transferAssetCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, bob.address, USDC.address, transferAmount]);
    await bulker.connect(alice).invoke([await bulker.ACTION_TRANSFER_ASSET()], [transferAssetCalldata]);

    expect(await baseBalanceOf(comet, alice.address)).to.be.equal(0n);
    expect(await baseBalanceOf(comet, bob.address)).to.be.equal(transferAmount);
  });

  it('transfer collateral asset', async () => {
    const protocol = await makeProtocol({});
    const { comet, tokens: { COMP, WETH }, users: [alice, bob] } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    const transferAmount = exp(10, 18);
    await comet.setCollateralBalance(alice.address, COMP.address, transferAmount);

    // Alice gives the Bulker permission over her account
    await comet.connect(alice).allow(bulker.address, true);

    // Alice transfer 10 COMP to Bob through the bulker
    const transferAssetCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, bob.address, COMP.address, transferAmount]);
    await bulker.connect(alice).invoke([await bulker.ACTION_TRANSFER_ASSET()], [transferAssetCalldata]);

    expect(await comet.collateralBalanceOf(alice.address, COMP.address)).to.be.equal(0);
    expect(await comet.collateralBalanceOf(bob.address, COMP.address)).to.be.equal(transferAmount);
  });

  it('withdraw base asset', async () => {
    const protocol = await makeProtocol({});
    const { comet, tokens: { USDC, WETH }, users: [alice] } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    // Allocate base asset to Comet and Alice's Comet balance
    const withdrawAmount = exp(10, 6);
    await USDC.allocateTo(comet.address, withdrawAmount);
    const t0 = Object.assign({}, await comet.totalsBasic(), {
      totalSupplyBase: withdrawAmount,
    });
    await wait(comet.setTotalsBasic(t0));
    await comet.setBasePrincipal(alice.address, withdrawAmount);

    // Alice gives the Bulker permission over her account
    await comet.connect(alice).allow(bulker.address, true);

    // Alice withdraws 10 USDC through the bulker
    const withdrawAssetCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, alice.address, USDC.address, withdrawAmount]);
    await bulker.connect(alice).invoke([await bulker.ACTION_WITHDRAW_ASSET()], [withdrawAssetCalldata]);

    expect(await baseBalanceOf(comet, alice.address)).to.be.equal(0n);
    expect(await USDC.balanceOf(alice.address)).to.be.equal(withdrawAmount);
  });

  it('withdraw collateral asset', async () => {
    const protocol = await makeProtocol({});
    const { comet, tokens: { COMP, WETH }, users: [alice] } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    // Allocate collateral asset to Comet and Alice's Comet balance
    const withdrawAmount = exp(10, 18);
    await COMP.allocateTo(comet.address, withdrawAmount);
    const t0 = Object.assign({}, await comet.totalsCollateral(COMP.address), {
      totalSupplyAsset: withdrawAmount,
    });
    await wait(comet.setTotalsCollateral(COMP.address, t0));
    await comet.setCollateralBalance(alice.address, COMP.address, withdrawAmount);

    // Alice gives the Bulker permission over her account
    await comet.connect(alice).allow(bulker.address, true);

    // Alice withdraws 10 COMP through the bulker
    const withdrawAssetCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, alice.address, COMP.address, withdrawAmount]);
    await bulker.connect(alice).invoke([await bulker.ACTION_WITHDRAW_ASSET()], [withdrawAssetCalldata]);

    expect(await comet.collateralBalanceOf(alice.address, COMP.address)).to.be.equal(0);
    expect(await COMP.balanceOf(alice.address)).to.be.equal(withdrawAmount);
  });

  it('withdraw collateral asset to a different account', async () => {
    const protocol = await makeProtocol({});
    const { comet, tokens: { COMP, WETH }, users: [alice, bob] } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    // Allocate collateral asset to Comet and Alice's Comet balance
    const withdrawAmount = exp(10, 18);
    await COMP.allocateTo(comet.address, withdrawAmount);
    const t0 = Object.assign({}, await comet.totalsCollateral(COMP.address), {
      totalSupplyAsset: withdrawAmount,
    });
    await wait(comet.setTotalsCollateral(COMP.address, t0));
    await comet.setCollateralBalance(alice.address, COMP.address, withdrawAmount);

    // Alice gives the Bulker permission over her account
    await comet.connect(alice).allow(bulker.address, true);

    // Alice withdraws 10 COMP through the bulker
    const withdrawAssetCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, bob.address, COMP.address, withdrawAmount]);
    await bulker.connect(alice).invoke([await bulker.ACTION_WITHDRAW_ASSET()], [withdrawAssetCalldata]);

    expect(await comet.collateralBalanceOf(alice.address, COMP.address)).to.be.equal(0);
    expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
    expect(await COMP.balanceOf(bob.address)).to.be.equal(withdrawAmount);
  });

  it('withdraw ETH', async () => {
    const protocol = await makeProtocol({
      assets: defaultAssets({}, {
        WETH: { factory: await ethers.getContractFactory('FaucetWETH') as FaucetWETH__factory }
      })
    });
    const { comet, tokens: { WETH }, users: [alice], governor } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    // Allocate WETH to Comet and Alice's Comet balance
    const withdrawAmount = exp(10, 18);
    await WETH.allocateTo(comet.address, withdrawAmount);
    await governor.sendTransaction({ to: WETH.address, value: withdrawAmount }); // seed WETH contract with ether
    const t0 = Object.assign({}, await comet.totalsCollateral(WETH.address), {
      totalSupplyAsset: withdrawAmount,
    });
    await wait(comet.setTotalsCollateral(WETH.address, t0));
    await comet.setCollateralBalance(alice.address, WETH.address, withdrawAmount);

    // Alice gives the Bulker permission over her account
    await comet.connect(alice).allow(bulker.address, true);

    // Alice supplies 10 ETH through the bulker
    const aliceBalanceBefore = await alice.getBalance();
    const withdrawEthCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [comet.address, alice.address, withdrawAmount]);
    const txn = await wait(bulker.connect(alice).invoke([await bulker.ACTION_WITHDRAW_ETH()], [withdrawEthCalldata]));
    const aliceBalanceAfter = await alice.getBalance();

    expect(await comet.collateralBalanceOf(alice.address, WETH.address)).to.be.equal(0);
    expect(aliceBalanceAfter.sub(aliceBalanceBefore)).to.be.equal(withdrawAmount - getGasUsed(txn));
  });

  it('claim rewards', async () => {
    const protocol = await makeProtocol({
      baseMinForRewards: 10e6,
    });
    const {
      comet,
      governor,
      tokens: { USDC, COMP, WETH },
      users: [alice],
    } = protocol;
    const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    // Allocate and approve transfers
    await COMP.allocateTo(rewards.address, exp(86400, 18));
    await USDC.allocateTo(alice.address, 10e6);
    await USDC.connect(alice).approve(comet.address, 10e6);

    // Supply once
    await comet.connect(alice).supply(USDC.address, 10e6);

    await fastForward(86400);

    expect(await COMP.balanceOf(alice.address)).to.be.equal(0);

    // Alice claims rewards through the bulker
    const claimRewardCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'address', 'bool'], [comet.address, rewards.address, alice.address, true]);
    await bulker.connect(alice).invoke([await bulker.ACTION_CLAIM_REWARD()], [claimRewardCalldata]);

    expect(await COMP.balanceOf(alice.address)).to.be.equal(exp(86400, 18));
  });

  it('reverts on supply asset if no permission granted to bulker', async () => {
    const protocol = await makeProtocol({});
    const { comet, tokens: { USDC, WETH }, users: [alice] } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    const supplyAssetCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, alice.address, USDC.address, 1]);
    await expect(bulker.connect(alice).invoke([await bulker.ACTION_SUPPLY_ASSET()], [supplyAssetCalldata]))
      .to.be.reverted; // Should revert with "custom error 'Unauthorized()'"
  });

  it('reverts on transfer asset if no permission granted to bulker', async () => {
    const protocol = await makeProtocol({});
    const { comet, tokens: { COMP, WETH }, users: [alice, bob] } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    const transferAssetCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, bob.address, COMP.address, 1]);
    await expect(bulker.connect(alice).invoke([await bulker.ACTION_TRANSFER_ASSET()], [transferAssetCalldata]))
      .to.be.reverted; // Should revert with "custom error 'Unauthorized()'"
  });

  it('reverts on withdraw asset if no permission granted to bulker', async () => {
    const protocol = await makeProtocol({});
    const { comet, tokens: { COMP, WETH }, users: [alice] } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    const withdrawAssetCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, alice.address, COMP.address, 1]);
    await expect(bulker.connect(alice).invoke([await bulker.ACTION_WITHDRAW_ASSET()], [withdrawAssetCalldata]))
      .to.be.reverted; // Should revert with "custom error 'Unauthorized()'"
  });

  it('reverts on withdraw ETH if no permission granted to bulker', async () => {
    const protocol = await makeProtocol({
      assets: defaultAssets({}, {
        WETH: { factory: await ethers.getContractFactory('FaucetWETH') as FaucetWETH__factory }
      })
    });
    const { comet, tokens: { WETH }, users: [alice] } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    const withdrawEthCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [comet.address, alice.address, 1]);
    await expect(bulker.connect(alice).invoke([await bulker.ACTION_WITHDRAW_ETH()], [withdrawEthCalldata]))
      .to.be.reverted; // Should revert with "custom error 'Unauthorized()'"
  });

  describe('admin functions', function () {
    it('sweep ERC20 token', async () => {
      const protocol = await makeProtocol({});
      const { governor, tokens: { USDC, WETH }, users: [alice] } = protocol;
      const bulkerInfo = await makeBulker({ admin: governor, weth: WETH.address });
      const { bulker } = bulkerInfo;

      // Alice "accidentally" sends 10 USDC to the Bulker
      const transferAmount = exp(10, 6);
      await USDC.allocateTo(alice.address, transferAmount);
      await USDC.connect(alice).transfer(bulker.address, transferAmount);

      const oldBulkerBalance = await USDC.balanceOf(bulker.address);
      const oldGovBalance = await USDC.balanceOf(governor.address);

      // Governor sweeps tokens
      await bulker.connect(governor).sweepToken(governor.address, USDC.address);

      const newBulkerBalance = await USDC.balanceOf(bulker.address);
      const newGovBalance = await USDC.balanceOf(governor.address);

      expect(newBulkerBalance.sub(oldBulkerBalance)).to.be.equal(-transferAmount);
      expect(newGovBalance.sub(oldGovBalance)).to.be.equal(transferAmount);
    });

    it('sweep ETH', async () => {
      const protocol = await makeProtocol({});
      const { governor, tokens: { WETH }, users: [alice] } = protocol;
      const bulkerInfo = await makeBulker({ admin: governor, weth: WETH.address });
      const { bulker } = bulkerInfo;

      // Alice "accidentally" sends 1 ETH to the Bulker
      const transferAmount = exp(1, 18);
      await alice.sendTransaction({ to: bulker.address, value: transferAmount });

      const oldBulkerBalance = await ethers.provider.getBalance(bulker.address);
      const oldGovBalance = await ethers.provider.getBalance(governor.address);

      // Governor sweeps ETH
      const txn = await wait(bulker.connect(governor).sweepEth(governor.address));

      const newBulkerBalance = await ethers.provider.getBalance(bulker.address);
      const newGovBalance = await ethers.provider.getBalance(governor.address);

      expect(newBulkerBalance.sub(oldBulkerBalance)).to.be.equal(-transferAmount);
      expect(newGovBalance.sub(oldGovBalance)).to.be.equal(transferAmount - getGasUsed(txn));
    });

    it('reverts if sweepToken is called by non-admin', async () => {
      const protocol = await makeProtocol({});
      const { governor, tokens: { USDC, WETH }, users: [alice] } = protocol;
      const bulkerInfo = await makeBulker({ admin: governor, weth: WETH.address });
      const { bulker } = bulkerInfo;

      // Alice sweeps tokens
      await expect(bulker.connect(alice).sweepToken(governor.address, USDC.address))
        .to.be.revertedWith("custom error 'Unauthorized()'");
    });

    it('reverts if sweepEth is called by non-admin', async () => {
      const protocol = await makeProtocol({});
      const { governor, tokens: { WETH }, users: [alice] } = protocol;
      const bulkerInfo = await makeBulker({ admin: governor, weth: WETH.address });
      const { bulker } = bulkerInfo;

      // Alice sweeps ETH
      await expect(bulker.connect(alice).sweepEth(governor.address))
        .to.be.revertedWith("custom error 'Unauthorized()'");
    });
  });
});

describe('bulker multiple actions', function () {
  it('supply collateral + borrow base asset', async () => {
    const protocol = await makeProtocol({});
    const { comet, tokens: { USDC, COMP, WETH }, users: [alice] } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    // Allocate base asset to Comet
    const borrowAmount = exp(10, 6);
    await USDC.allocateTo(comet.address, borrowAmount);
    const t0 = Object.assign({}, await comet.totalsBasic(), {
      totalSupplyBase: borrowAmount,
    });
    await wait(comet.setTotalsBasic(t0));

    // Alice approves 100 COMP to Comet
    const supplyAmount = exp(100, 18);
    await COMP.allocateTo(alice.address, supplyAmount);
    await COMP.connect(alice).approve(comet.address, ethers.constants.MaxUint256);

    // Alice gives the Bulker permission over her account
    await comet.connect(alice).allow(bulker.address, true);

    // Alice supplies 10 COMP through the bulker
    const supplyAssetCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, alice.address, COMP.address, supplyAmount]);
    // Alice withdraws 10 USDC through the bulker
    const withdrawAssetCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, alice.address, USDC.address, borrowAmount]);
    await bulker.connect(alice).invoke(
      [await bulker.ACTION_SUPPLY_ASSET(), await bulker.ACTION_WITHDRAW_ASSET()],
      [supplyAssetCalldata, withdrawAssetCalldata]
    );

    expect(await comet.collateralBalanceOf(alice.address, COMP.address)).to.be.equal(supplyAmount);
    // expect(await comet.baseBalanceOf(alice.address)).to.be.equal(-borrowAmount); // XXX uncomment once rounding bug from PR 260 is merged
    expect(await USDC.balanceOf(alice.address)).to.be.equal(borrowAmount);
  });

  it('supply ETH to multiple accounts', async () => {
    const protocol = await makeProtocol({
      assets: defaultAssets({}, {
        WETH: { factory: await ethers.getContractFactory('FaucetWETH') as FaucetWETH__factory }
      })
    });
    const { comet, tokens: { WETH }, users: [alice, bob] } = protocol;
    const bulkerInfo = await makeBulker({ weth: WETH.address });
    const { bulker } = bulkerInfo;

    // No approval is actually needed on the supplyEth action!

    // Alice supplies 10 ETH through the bulker
    const supplyAmount = exp(10, 18);
    const supplyAliceEthCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [comet.address, alice.address, supplyAmount / 2n]);
    const supplyBobEthCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [comet.address, bob.address, supplyAmount / 2n]);
    await bulker.connect(alice).invoke(
      [await bulker.ACTION_SUPPLY_ETH(), await bulker.ACTION_SUPPLY_ETH()],
      [supplyAliceEthCalldata, supplyBobEthCalldata],
      { value: supplyAmount }
    );

    expect(await comet.collateralBalanceOf(alice.address, WETH.address)).to.be.equal(supplyAmount / 2n);
    expect(await comet.collateralBalanceOf(bob.address, WETH.address)).to.be.equal(supplyAmount / 2n);
  });
});