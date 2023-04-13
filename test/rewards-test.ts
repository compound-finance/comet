import { ethers } from 'hardhat';
import { defaultAssets, expect, exp, factorScale, fastForward, makeProtocol, makeRewards, objectify, wait, event, getBlock } from './helpers';

describe('CometRewards', () => {
  describe('claim + supply', () => {
    it('can construct and claim rewards for owner with upscale', async () => {
      const {
        comet,
        governor,
        tokens: { USDC, COMP },
        users: [alice],
      } = await makeProtocol({
        baseMinForRewards: 10e6,
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      // allocate and approve transfers
      await COMP.allocateTo(rewards.address, exp(86400, 18));
      await USDC.allocateTo(alice.address, 10e6);
      await USDC.connect(alice).approve(comet.address, 10e6);

      // supply once
      await comet.connect(alice).supply(USDC.address, 10e6);

      await fastForward(86400);

      expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
      const txn = await wait(rewards.claim(comet.address, alice.address, true));
      expect(await COMP.balanceOf(alice.address)).to.be.equal(exp(86400, 18));

      // Note: First event is an ERC20 Transfer event
      expect(event(txn, 1)).to.be.deep.equal({
        RewardClaimed: {
          src: alice.address,
          recipient: alice.address,
          token: COMP.address,
          amount: exp(86400, 18),
        }
      });
    });

    it('can construct and claim rewards for owner with downscale', async () => {
      const {
        comet,
        governor,
        tokens: { USDC, COMP },
        users: [alice],
      } = await makeProtocol({
        assets: defaultAssets({}, {
          COMP: { decimals: 5 }
        })
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      // allocate and approve transfers
      await COMP.allocateTo(rewards.address, exp(86400, 5));
      await USDC.allocateTo(alice.address, 10e6);
      await USDC.connect(alice).approve(comet.address, 10e6);

      // supply once
      await comet.connect(alice).supply(USDC.address, 10e6);

      await fastForward(86400);

      expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
      const txn = await wait(rewards.claim(comet.address, alice.address, true));
      expect(await COMP.balanceOf(alice.address)).to.be.equal(exp(86400, 5));

      // Note: First event is an ERC20 Transfer event
      expect(event(txn, 1)).to.be.deep.equal({
        RewardClaimed: {
          src: alice.address,
          recipient: alice.address,
          token: COMP.address,
          amount: exp(86400, 5),
        }
      });
    });

    it('can construct and claim rewards for owner with same scale', async () => {
      const {
        comet,
        governor,
        tokens: { USDC, COMP },
        users: [alice],
      } = await makeProtocol({
        assets: defaultAssets({}, {
          COMP: { decimals: 6 }
        })
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      // allocate and approve transfers
      await COMP.allocateTo(rewards.address, exp(86400, 6));
      await USDC.allocateTo(alice.address, 10e6);
      await USDC.connect(alice).approve(comet.address, 10e6);

      // supply once
      await comet.connect(alice).supply(USDC.address, 10e6);

      await fastForward(86400);

      expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
      const txn = await wait(rewards.claim(comet.address, alice.address, true));
      expect(await COMP.balanceOf(alice.address)).to.be.equal(exp(86400, 6));

      // Note: First event is an ERC20 Transfer event
      expect(event(txn, 1)).to.be.deep.equal({
        RewardClaimed: {
          src: alice.address,
          recipient: alice.address,
          token: COMP.address,
          amount: exp(86400, 6),
        }
      });
    });

    it('does not overpay when claiming more than once', async () => {
      const {
        comet,
        governor,
        tokens: { USDC, COMP },
        users: [alice],
      } = await makeProtocol({
        baseMinForRewards: 10e6,
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      // allocate and approve transfers
      await COMP.allocateTo(rewards.address, exp(864000, 18));
      await USDC.allocateTo(alice.address, 10e6);
      await USDC.connect(alice).approve(comet.address, 10e6);

      // supply once
      await comet.connect(alice).supply(USDC.address, 10e6);

      await fastForward(86400);

      expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
      const _tx0 = await wait(rewards.claim(comet.address, alice.address, true));
      const _tx1 = await wait(rewards.claim(comet.address, alice.address, false));
      expect(await COMP.balanceOf(alice.address)).to.be.equal(exp(86400, 18));
    });

    it('fails if comet instance is already configured', async () => {
      const {
        comet,
        governor,
        tokens: { COMP },
      } = await makeProtocol({
        baseMinForRewards: 10e6,
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });
      await expect(
        rewards.setRewardConfig(comet.address, COMP.address)
        //).to.be.revertedWith(`custom error 'AlreadyConfigured("${comet.address}")`);
      ).to.be.revertedWith(`custom error 'AlreadyConfigured(address)'`);
    });

    it('fails if comet instance is not configured', async () => {
      const {
        comet,
        governor,
        users: [alice],
      } = await makeProtocol();
      const { rewards } = await makeRewards({ governor, configs: [] });

      await expect(
        rewards
          .claim(comet.address, alice.address, true)
        //).to.be.revertedWith(`custom error 'NotSupported("${comet.address}")`);
      ).to.be.revertedWith(`custom error 'NotSupported(address)'`);
    });

    it('fails if not enough rewards in the pool to transfer', async () => {
      const {
        comet,
        governor,
        tokens: { USDC, COMP },
        users: [alice],
      } = await makeProtocol({
        baseMinForRewards: 10e6,
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      // allocate and approve transfers
      await USDC.allocateTo(alice.address, 10e6);
      await USDC.connect(alice).approve(comet.address, 10e6);

      // supply once
      await comet.connect(alice).supply(USDC.address, 10e6);

      await expect(
        rewards
          .claim(comet.address, alice.address, true)
      ).to.be.revertedWith('ERC20: transfer amount exceeds balance');
    });
  });

  describe('claimTo + borrow', () => {
    it('can construct and claim rewards to target with upscale', async () => {
      const {
        comet,
        governor,
        tokens: { USDC, COMP, WBTC },
        users: [alice, bob],
      } = await makeProtocol({
        baseMinForRewards: exp(10, 6),
        baseTrackingBorrowSpeed: exp(2, 15)
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      // allocate and approve transfers
      await COMP.allocateTo(rewards.address, exp(86400 * 2, 18));
      await USDC.allocateTo(comet.address, exp(1e6, 6));
      await WBTC.allocateTo(alice.address, exp(1, 8));
      await WBTC.connect(alice).approve(comet.address, exp(1, 8));

      // allow manager, supply collateral, borrow
      await comet.connect(alice).allow(bob.address, true);
      await comet.connect(alice).supply(WBTC.address, exp(1, 8));
      await comet.connect(alice).withdraw(USDC.address, exp(10, 6));

      await fastForward(86400);

      expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
      expect(await USDC.balanceOf(alice.address)).to.be.equal(10e6);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(10e6);
      const tx = await wait(rewards.connect(bob).claimTo(comet.address, alice.address, bob.address, true));
      expect(await COMP.balanceOf(bob.address)).to.be.equal(exp(86400 * 2, 18));

      // Note: First event is an ERC20 Transfer event
      expect(event(tx, 1)).to.be.deep.equal({
        RewardClaimed: {
          src: alice.address,
          recipient: bob.address,
          token: COMP.address,
          amount: exp(86400 * 2, 18),
        }
      });
    });

    it('can construct and claim rewards to target with downscale', async () => {
      const {
        comet,
        governor,
        tokens: { USDC, COMP, WBTC },
        users: [alice, bob],
      } = await makeProtocol({
        assets: defaultAssets({}, {
          COMP: { decimals: 5 }
        }),
        baseMinForRewards: exp(10, 5),
        baseTrackingBorrowSpeed: exp(2, 15)
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      // allocate and approve transfers
      await COMP.allocateTo(rewards.address, exp(86400 * 2, 5));
      await USDC.allocateTo(comet.address, exp(1e6, 6));
      await WBTC.allocateTo(alice.address, exp(1, 8));
      await WBTC.connect(alice).approve(comet.address, exp(1, 8));

      // allow manager, supply collateral, borrow
      await comet.connect(alice).allow(bob.address, true);
      await comet.connect(alice).supply(WBTC.address, exp(1, 8));
      await comet.connect(alice).withdraw(USDC.address, exp(10, 6));

      await fastForward(86400);

      expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
      expect(await USDC.balanceOf(alice.address)).to.be.equal(10e6);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(10e6);
      const _tx = await wait(rewards.connect(bob).claimTo(comet.address, alice.address, bob.address, true));
      expect(await COMP.balanceOf(bob.address)).to.be.equal(exp(86400 * 2, 5));
    });

    it('can construct and claim rewards to target with same scale', async () => {
      const {
        comet,
        governor,
        tokens: { USDC, COMP, WBTC },
        users: [alice, bob],
      } = await makeProtocol({
        assets: defaultAssets({}, {
          COMP: { decimals: 6 }
        }),
        baseMinForRewards: exp(10, 6),
        baseTrackingBorrowSpeed: exp(2, 15)
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      // allocate and approve transfers
      await COMP.allocateTo(rewards.address, exp(86400 * 2, 6));
      await USDC.allocateTo(comet.address, exp(1e6, 6));
      await WBTC.allocateTo(alice.address, exp(1, 8));
      await WBTC.connect(alice).approve(comet.address, exp(1, 8));

      // allow manager, supply collateral, borrow
      await comet.connect(alice).allow(bob.address, true);
      await comet.connect(alice).supply(WBTC.address, exp(1, 8));
      await comet.connect(alice).withdraw(USDC.address, exp(10, 6));

      await fastForward(86400);

      expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
      expect(await USDC.balanceOf(alice.address)).to.be.equal(10e6);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(10e6);
      const _tx = await wait(rewards.connect(bob).claimTo(comet.address, alice.address, bob.address, true));
      expect(await COMP.balanceOf(bob.address)).to.be.equal(exp(86400 * 2, 6));
    });

    it('does not allow claiming more than once', async () => {
      const {
        comet,
        governor,
        tokens: { USDC, COMP, WBTC },
        users: [alice, bob],
      } = await makeProtocol({
        baseMinForRewards: exp(10, 6),
        baseTrackingBorrowSpeed: exp(2, 15)
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      // allocate and approve transfers
      await COMP.allocateTo(rewards.address, exp(86400 * 2, 18));
      await USDC.allocateTo(comet.address, exp(1e6, 6));
      await WBTC.allocateTo(alice.address, exp(1, 8));
      await WBTC.connect(alice).approve(comet.address, exp(1, 8));

      // allow manager, supply collateral, borrow
      await comet.connect(alice).allow(bob.address, true);
      await comet.connect(alice).supply(WBTC.address, exp(1, 8));
      await comet.connect(alice).withdraw(USDC.address, exp(10, 6));

      await fastForward(86400);

      expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
      expect(await USDC.balanceOf(alice.address)).to.be.equal(10e6);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(10e6);
      const _tx0 = await wait(rewards.connect(bob).claimTo(comet.address, alice.address, bob.address, true));
      const _tx1 = await wait(rewards.connect(bob).claimTo(comet.address, alice.address, bob.address, false));
      expect(await COMP.balanceOf(bob.address)).to.be.equal(exp(86400 * 2, 18));
    });

    it('fails if comet instance is not configured', async () => {
      const {
        comet,
        governor,
        users: [alice, bob],
      } = await makeProtocol();
      const { rewards } = await makeRewards({ governor, configs: [] });

      await comet.connect(alice).allow(bob.address, true);
      await expect(
        rewards
          .connect(bob)
          .claim(comet.address, alice.address, true)
        //).to.be.revertedWith(`custom error 'NotSupported("${comet.address}")`);
      ).to.be.revertedWith(`custom error 'NotSupported(address)'`);
    });

    it('fails if not enough rewards in the pool to transfer', async () => {
      const {
        comet,
        governor,
        tokens: { USDC, COMP, WBTC },
        users: [alice, bob],
      } = await makeProtocol({
        baseMinForRewards: 10e6,
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      // allocate and approve transfers
      await USDC.allocateTo(comet.address, exp(1e6, 6));
      await WBTC.allocateTo(alice.address, exp(1, 8));
      await WBTC.connect(alice).approve(comet.address, exp(1, 8));

      // allow manager, supply collateral, borrow
      await comet.connect(alice).allow(bob.address, true);
      await comet.connect(alice).supply(WBTC.address, exp(1, 8));
      await comet.connect(alice).withdraw(USDC.address, exp(10, 6));

      await expect(
        rewards
          .connect(bob)
          .claimTo(comet.address, alice.address, bob.address, true)
      ).to.be.revertedWith('ERC20: transfer amount exceeds balance');
    });

    it('fails if caller is not permitted to claim rewards for owner', async () => {
      const {
        comet,
        governor,
        tokens: { COMP },
        users: [alice],
      } = await makeProtocol({
        baseMinForRewards: exp(10, 6),
        baseTrackingBorrowSpeed: exp(2, 15)
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });
      await expect(
        rewards
          .claimTo(comet.address, alice.address, governor.address, true)
        //).to.be.revertedWith(`custom error 'NotPermitted("${governor.address}")'`);
      ).to.be.revertedWith(`custom error 'NotPermitted(address)'`);
    });
  });

  describe('getRewardOwed', () => {
    it('can construct and calculate rewards for owner with upscale', async () => {
      const {
        comet,
        governor,
        tokens: { USDC, COMP },
        users: [alice],
      } = await makeProtocol({
        baseMinForRewards: 10e6,
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      // allocate and approve transfers
      await COMP.allocateTo(rewards.address, exp(86400, 18));
      await USDC.allocateTo(alice.address, 10e6);
      await USDC.connect(alice).approve(comet.address, 10e6);

      // supply once
      await comet.connect(alice).supply(USDC.address, 10e6);

      await fastForward(86400);
      await ethers.provider.send('evm_mine', []);

      expect(await COMP.balanceOf(alice.address)).to.be.equal(0);

      const { token, owed } = await rewards.callStatic.getRewardOwed(comet.address, alice.address);

      expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
      expect(token).to.be.equal(COMP.address);
      expect(owed).to.be.equal(exp(86400, 18));
    });

    it('can construct and calculate rewards for owner with downscale', async () => {
      const {
        comet,
        governor,
        tokens: { USDC, COMP },
        users: [alice],
      } = await makeProtocol({
        assets: defaultAssets({}, {
          COMP: { decimals: 5 }
        })
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      // allocate and approve transfers
      await COMP.allocateTo(rewards.address, exp(86400, 5));
      await USDC.allocateTo(alice.address, 10e6);
      await USDC.connect(alice).approve(comet.address, 10e6);

      // supply once
      await comet.connect(alice).supply(USDC.address, 10e6);

      await fastForward(86400);
      await ethers.provider.send('evm_mine', []);

      expect(await COMP.balanceOf(alice.address)).to.be.equal(0);

      const { token, owed } = await rewards.callStatic.getRewardOwed(comet.address, alice.address);

      expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
      expect(token).to.be.equal(COMP.address);
      expect(owed).to.be.equal(exp(86400, 5));
    });

    it('can construct and calculate rewards for owner with same scale', async () => {
      const {
        comet,
        governor,
        tokens: { USDC, COMP },
        users: [alice],
      } = await makeProtocol({
        assets: defaultAssets({}, {
          COMP: { decimals: 6 }
        })
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      // allocate and approve transfers
      await COMP.allocateTo(rewards.address, exp(86400, 6));
      await USDC.allocateTo(alice.address, 10e6);
      await USDC.connect(alice).approve(comet.address, 10e6);

      // supply once
      await comet.connect(alice).supply(USDC.address, 10e6);

      await fastForward(86400);
      await ethers.provider.send('evm_mine', []);

      expect(await COMP.balanceOf(alice.address)).to.be.equal(0);

      const { token, owed } = await rewards.callStatic.getRewardOwed(comet.address, alice.address);

      expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
      expect(token).to.be.equal(COMP.address);
      expect(owed).to.be.equal(exp(86400, 6));
    });

    it('returns 0 owed if user already claimed', async () => {
      const {
        comet,
        governor,
        tokens: { USDC, COMP },
        users: [alice],
      } = await makeProtocol({
        baseMinForRewards: 10e6,
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      // allocate and approve transfers
      await COMP.allocateTo(rewards.address, exp(864000, 18));
      await USDC.allocateTo(alice.address, 10e6);
      await USDC.connect(alice).approve(comet.address, 10e6);

      // supply once
      await comet.connect(alice).supply(USDC.address, 10e6);

      await fastForward(86400);

      expect(await COMP.balanceOf(alice.address)).to.be.equal(0);

      const _tx0 = await wait(rewards.claim(comet.address, alice.address, true));
      const { token, owed } = await rewards.callStatic.getRewardOwed(comet.address, alice.address);

      expect(await COMP.balanceOf(alice.address)).to.be.equal(exp(86400, 18));
      expect(token).to.be.equal(COMP.address);
      expect(owed).to.be.equal(0);
    });

    it('fails if comet instance is not configured', async () => {
      const {
        comet,
        governor,
        users: [alice],
      } = await makeProtocol();
      const { rewards } = await makeRewards({ governor, configs: [] });

      await expect(
        rewards
          .getRewardOwed(comet.address, alice.address)
        //).to.be.revertedWith(`custom error 'NotSupported("${comet.address}")`);
      ).to.be.revertedWith(`custom error 'NotSupported(address)'`);
    });
  });

  describe('setRewardConfig', () => {
    it('allows governor to set rewards token with upscale', async () => {
      const {
        comet,
        governor,
        tokens: { COMP },
      } = await makeProtocol();
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      expect(objectify(await rewards.rewardConfig(comet.address))).to.be.deep.equal({
        token: COMP.address,
        rescaleFactor: exp(1, 12),
        shouldUpscale: true,
        multiplier: exp(1, 18)
      });
    });

    it('allows governor to set rewards token with downscale', async () => {
      const {
        comet,
        governor,
        tokens: { COMP },
      } = await makeProtocol({
        assets: defaultAssets({}, {
          COMP: { decimals: 5 }
        })
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      expect(objectify(await rewards.rewardConfig(comet.address))).to.be.deep.equal({
        token: COMP.address,
        rescaleFactor: 10n,
        shouldUpscale: false,
        multiplier: exp(1, 18)
      });
    });

    it('allows governor to set rewards token with same scale', async () => {
      const {
        comet,
        governor,
        tokens: { COMP },
      } = await makeProtocol({
        assets: defaultAssets({}, {
          COMP: { decimals: 6 }
        })
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      expect(objectify(await rewards.rewardConfig(comet.address))).to.be.deep.equal({
        token: COMP.address,
        rescaleFactor: 1n,
        shouldUpscale: true,
        multiplier: exp(1, 18)
      });
    });

    it('does not allow anyone but governor to set config', async () => {
      const {
        comet,
        governor,
        tokens: { COMP },
        users: [alice],
      } = await makeProtocol();
      const { rewards } = await makeRewards({ governor, configs: [] });

      expect(await rewards.governor()).to.be.equal(governor.address);
      await expect(
        rewards
          .connect(alice)
          .setRewardConfig(comet.address, COMP.address)
        //).to.be.revertedWith(`custom error 'NotPermitted("${alice.address}")'`);
      ).to.be.revertedWith(`custom error 'NotPermitted(address)'`);
    });
  });

  describe('withdrawToken', () => {
    it('allows governor to withdraw funds added', async () => {
      const {
        comet,
        governor,
        tokens: { COMP },
        users: [alice],
      } = await makeProtocol();
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      // allocate
      const _a0 = await COMP.allocateTo(rewards.address, 2e6);

      const _tx = await wait(rewards.withdrawToken(COMP.address, alice.address, 2e6));
      expect(await COMP.balanceOf(alice.address)).to.be.equal(2e6);
    });

    it('does not allow anyone but governor to withdraw', async () => {
      const {
        comet,
        governor,
        tokens: { COMP },
        users: [alice],
      } = await makeProtocol();
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      // allocate
      const _a0 = await COMP.allocateTo(rewards.address, 2e6);

      await expect(
        rewards
          .connect(alice)
          .withdrawToken(COMP.address, alice.address, 2e6)
      //).to.be.revertedWith(`custom error 'NotPermitted("${alice.address}")'`);
      ).to.be.revertedWith(`custom error 'NotPermitted(address)'`);
    });
  });

  describe('setRewardsClaimed', () => {
    it('allows governor to set rewards claimed', async () => {
      const {
        comet,
        governor,
        tokens: { COMP },
        users: [alice, bob],
      } = await makeProtocol();
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      const txn = await wait(rewards.setRewardsClaimed(comet.address, [alice.address, bob.address], [exp(1, 18), exp(2, 18)]));

      expect(await rewards.rewardsClaimed(comet.address, alice.address)).to.be.equal(exp(1, 18));
      expect(await rewards.rewardsClaimed(comet.address, bob.address)).to.be.equal(exp(2, 18));
      // Check that reward owed still works as expected
      const aliceRewardOwed = await rewards.callStatic.getRewardOwed(comet.address, alice.address);
      const bobRewardOwed = await rewards.callStatic.getRewardOwed(comet.address, bob.address);
      expect(aliceRewardOwed.owed).to.be.equal(0);
      expect(bobRewardOwed.owed).to.be.equal(0);

      expect(event(txn, 0)).to.be.deep.equal({
        RewardsClaimedSet: {
          user: alice.address,
          comet: comet.address,
          amount: exp(1, 18)
        }
      });
      expect(event(txn, 1)).to.be.deep.equal({
        RewardsClaimedSet: {
          user: bob.address,
          comet: comet.address,
          amount: exp(2, 18)
        }
      });
    });

    it('can be used to zero out retroactive rewards for users', async () => {
      const {
        comet,
        governor,
        tokens: { COMP, USDC },
        users: [alice],
      } = await makeProtocol({
        baseMinForRewards: 10e6
      });
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      // Get Alice into a state where she is owed 86400e18 rewards
      await COMP.allocateTo(rewards.address, exp(86400, 18));
      await USDC.allocateTo(alice.address, 10e6);
      await USDC.connect(alice).approve(comet.address, 10e6);
      await comet.connect(alice).supply(USDC.address, 10e6);
      await fastForward(86400);
      await ethers.provider.send('evm_mine', []);
      const aliceRewardOwedBefore = await rewards.callStatic.getRewardOwed(comet.address, alice.address);
      expect(aliceRewardOwedBefore.owed).to.be.equal(exp(86400, 18));
      expect(await rewards.rewardsClaimed(comet.address, alice.address)).to.be.equal(0);

      // Set rewards claimed for Alice to zero out the rewards owed
      const timestampPreTxn = (await getBlock()).timestamp;
      const _tx = await wait(rewards.setRewardsClaimed(comet.address, [alice.address], [exp(86400, 18)]));
      const elapsed = (await getBlock()).timestamp - timestampPreTxn;

      // Check that rewards owed has been zeroed out
      const aliceRewardOwedAfter = await rewards.callStatic.getRewardOwed(comet.address, alice.address);
      const expectedRewardOwed = exp(elapsed, 18);
      expect(await rewards.rewardsClaimed(comet.address, alice.address)).to.be.equal(exp(86400, 18));
      expect(aliceRewardOwedAfter.owed).to.be.equal(expectedRewardOwed);

      // Make sure that claiming doesn't transfer any retroactive rewards to Alice
      expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
      const _tx2 = await wait(rewards.claim(comet.address, alice.address, true));
      const elapsedSinceSetRewardsClaimed = (await getBlock()).timestamp - timestampPreTxn;
      const expectedRewardClaimed = exp(elapsedSinceSetRewardsClaimed, 18);
      expect(await COMP.balanceOf(alice.address)).to.be.equal(expectedRewardClaimed);
    });

    it('reverts if addresses and claimedAmounts have different lengths', async () => {
      const {
        comet,
        governor,
        tokens: { COMP },
        users: [alice],
      } = await makeProtocol();
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      await expect(
        rewards
          .setRewardsClaimed(comet.address, [alice.address], [])
      ).to.be.revertedWith(`custom error 'BadData()'`);
    });

    it('does not allow anyone but governor to set rewards claimed', async () => {
      const {
        comet,
        governor,
        tokens: { COMP },
        users: [alice],
      } = await makeProtocol();
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      await expect(
        rewards
          .connect(alice)
          .setRewardsClaimed(comet.address, [alice.address], [exp(100, 18)])
      //).to.be.revertedWith(`custom error 'NotPermitted("${alice.address}")'`);
      ).to.be.revertedWith(`custom error 'NotPermitted(address)'`);
    });
  });

  describe('transferGovernor', () => {
    it('allows governor to transfer governor', async () => {
      const {
        comet,
        governor,
        tokens: { COMP },
        users: [alice],
      } = await makeProtocol();
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      const txn = await wait(rewards.transferGovernor(alice.address));

      expect(await rewards.governor()).to.be.equal(alice.address);
      expect(event(txn, 0)).to.be.deep.equal({
        GovernorTransferred: {
          oldGovernor: governor.address,
          newGovernor: alice.address,
        }
      });
    });

    it('does not allow anyone but governor to transfer governor', async () => {
      const {
        comet,
        governor,
        tokens: { COMP },
        users: [alice],
      } = await makeProtocol();
      const { rewards } = await makeRewards({ governor, configs: [[comet, COMP]] });

      await expect(
        rewards
          .connect(alice)
          .transferGovernor(alice.address)
        //).to.be.revertedWith(`custom error 'NotPermitted("${alice.address}")'`);
      ).to.be.revertedWith(`custom error 'NotPermitted(address)'`);
    });
  });
});

const TEST_CASES = [
  { multiplier: 598314321.512341 },
  { multiplier: 23141 },
  { multiplier: 100 },
  { multiplier: 5.79 },
  { multiplier: 1.33333332 },
  { multiplier: 0.98765 },
  { multiplier: 0.55 },
  { multiplier: 0.12345 },
  { multiplier: 0.01 },
  { multiplier: 0.0598 },
  { multiplier: 0.00355 },
  { multiplier: 0.000015 },
  { multiplier: 0.00000888 }
];

for (const { multiplier } of TEST_CASES) {
  describe(`CometRewards with multiplier ${multiplier}`, () => {
    const MULTIPLIER = multiplier;
    const MULTIPLIER_FACTOR = exp(MULTIPLIER, 18);

    describe('claim + supply', () => {
      it('can construct and claim rewards for owner with upscale', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP },
          users: [alice]
        } = await makeProtocol({
          assets: defaultAssets(
            {},
            {
              COMP: { decimals: 18 }
            }
          ),
          baseMinForRewards: 10e6
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await COMP.allocateTo(rewards.address, exp(86400 * MULTIPLIER, 18));
        await USDC.allocateTo(alice.address, 10e6);
        await USDC.connect(alice).approve(comet.address, 10e6);

        // supply once
        await comet.connect(alice).supply(USDC.address, 10e6);

        await fastForward(86400);

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
        const txn = await wait(rewards.claim(comet.address, alice.address, true));
        expect(await COMP.balanceOf(alice.address)).to.be.equal(
          (exp(86400, 18) * MULTIPLIER_FACTOR) / factorScale
        );

        // Note: First event is an ERC20 Transfer event
        expect(event(txn, 1)).to.be.deep.equal({
          RewardClaimed: {
            src: alice.address,
            recipient: alice.address,
            token: COMP.address,
            amount: (exp(86400, 18) * MULTIPLIER_FACTOR) / factorScale
          }
        });
      });

      it('can construct and claim rewards for owner with downscale', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP },
          users: [alice]
        } = await makeProtocol({
          assets: defaultAssets(
            {},
            {
              COMP: { decimals: 2 }
            }
          )
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await COMP.allocateTo(rewards.address, exp(86400 * MULTIPLIER, 2));
        await USDC.allocateTo(alice.address, 10e6);
        await USDC.connect(alice).approve(comet.address, 10e6);

        // supply once
        await comet.connect(alice).supply(USDC.address, 10e6);

        await fastForward(86400);

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
        const txn = await wait(rewards.claim(comet.address, alice.address, true));
        expect(await COMP.balanceOf(alice.address)).to.be.equal(
          (exp(86400, 2) * MULTIPLIER_FACTOR) / factorScale
        );

        // Note: First event is an ERC20 Transfer event
        expect(event(txn, 1)).to.be.deep.equal({
          RewardClaimed: {
            src: alice.address,
            recipient: alice.address,
            token: COMP.address,
            amount: (exp(86400, 2) * MULTIPLIER_FACTOR) / factorScale
          }
        });
      });

      it('can construct and claim rewards for owner with upscale with small rescale factor', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP },
          users: [alice]
        } = await makeProtocol({
          assets: defaultAssets(
            {},
            {
              COMP: { decimals: 7 }
            }
          )
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await COMP.allocateTo(rewards.address, exp(86400 * MULTIPLIER, 7));
        await USDC.allocateTo(alice.address, 10e6);
        await USDC.connect(alice).approve(comet.address, 10e6);

        // supply once
        await comet.connect(alice).supply(USDC.address, 10e6);

        await fastForward(86400);

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
        const txn = await wait(rewards.claim(comet.address, alice.address, true));
        expect(await COMP.balanceOf(alice.address)).to.be.equal(
          (exp(86400, 7) * MULTIPLIER_FACTOR) / factorScale
        );

        // Note: First event is an ERC20 Transfer event
        expect(event(txn, 1)).to.be.deep.equal({
          RewardClaimed: {
            src: alice.address,
            recipient: alice.address,
            token: COMP.address,
            amount: (exp(86400, 7) * MULTIPLIER_FACTOR) / factorScale
          }
        });
      });

      it('can construct and claim rewards for owner with downscale with small rescale factor', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP },
          users: [alice]
        } = await makeProtocol({
          assets: defaultAssets(
            {},
            {
              COMP: { decimals: 5 }
            }
          )
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await COMP.allocateTo(rewards.address, exp(86400 * MULTIPLIER, 5));
        await USDC.allocateTo(alice.address, 10e6);
        await USDC.connect(alice).approve(comet.address, 10e6);

        // supply once
        await comet.connect(alice).supply(USDC.address, 10e6);

        await fastForward(86400);

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
        const txn = await wait(rewards.claim(comet.address, alice.address, true));
        expect(await COMP.balanceOf(alice.address)).to.be.equal(
          (exp(86400, 5) * MULTIPLIER_FACTOR) / factorScale
        );

        // Note: First event is an ERC20 Transfer event
        expect(event(txn, 1)).to.be.deep.equal({
          RewardClaimed: {
            src: alice.address,
            recipient: alice.address,
            token: COMP.address,
            amount: (exp(86400, 5) * MULTIPLIER_FACTOR) / factorScale
          }
        });
      });

      it('can construct and claim rewards for owner with same scale', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP },
          users: [alice]
        } = await makeProtocol({
          assets: defaultAssets(
            {},
            {
              COMP: { decimals: 6 }
            }
          )
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await COMP.allocateTo(rewards.address, exp(86400 * MULTIPLIER, 6));
        await USDC.allocateTo(alice.address, 10e6);
        await USDC.connect(alice).approve(comet.address, 10e6);

        // supply once
        await comet.connect(alice).supply(USDC.address, 10e6);

        await fastForward(86400);

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
        const txn = await wait(rewards.claim(comet.address, alice.address, true));
        expect(await COMP.balanceOf(alice.address)).to.be.equal(
          (exp(86400, 6) * MULTIPLIER_FACTOR) / factorScale
        );

        // Note: First event is an ERC20 Transfer event
        expect(event(txn, 1)).to.be.deep.equal({
          RewardClaimed: {
            src: alice.address,
            recipient: alice.address,
            token: COMP.address,
            amount: (exp(86400, 6) * MULTIPLIER_FACTOR) / factorScale
          }
        });
      });

      it('does not overpay when claiming more than once', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP },
          users: [alice]
        } = await makeProtocol({
          baseMinForRewards: 10e6
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await COMP.allocateTo(rewards.address, exp(86400 * MULTIPLIER, 18));
        await USDC.allocateTo(alice.address, 10e6);
        await USDC.connect(alice).approve(comet.address, 10e6);

        // supply once
        await comet.connect(alice).supply(USDC.address, 10e6);

        await fastForward(86400);

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
        const _tx0 = await wait(rewards.claim(comet.address, alice.address, true));
        const _tx1 = await wait(rewards.claim(comet.address, alice.address, false));
        expect(await COMP.balanceOf(alice.address)).to.be.equal(
          (exp(86400, 18) * MULTIPLIER_FACTOR) / factorScale
        );
      });

      it('fails if comet instance is already configured', async () => {
        const {
          comet,
          governor,
          tokens: { COMP }
        } = await makeProtocol({
          baseMinForRewards: 10e6
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });
        await expect(
          rewards.setRewardConfig(comet.address, COMP.address)
          //).to.be.revertedWith(`custom error 'AlreadyConfigured("${comet.address}")`);
        ).to.be.revertedWith(`custom error 'AlreadyConfigured(address)'`);
      });

      it('fails if comet instance is not configured', async () => {
        const {
          comet,
          governor,
          users: [alice]
        } = await makeProtocol();
        const { rewards } = await makeRewards({ governor, configs: [] });

        await expect(
          rewards.claim(comet.address, alice.address, true)
          //).to.be.revertedWith(`custom error 'NotSupported("${comet.address}")`);
        ).to.be.revertedWith(`custom error 'NotSupported(address)'`);
      });

      it('fails if not enough rewards in the pool to transfer', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP },
          users: [alice]
        } = await makeProtocol({
          baseMinForRewards: 10e6
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await USDC.allocateTo(alice.address, 10e6);
        await USDC.connect(alice).approve(comet.address, 10e6);

        // supply once
        await comet.connect(alice).supply(USDC.address, 10e6);

        await expect(rewards.claim(comet.address, alice.address, true)).to.be.revertedWith(
          'ERC20: transfer amount exceeds balance'
        );
      });
    });

    describe('claimTo + borrow', () => {
      it('can construct and claim rewards to target with upscale', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP, WBTC },
          users: [alice, bob]
        } = await makeProtocol({
          baseMinForRewards: exp(10, 6),
          baseTrackingBorrowSpeed: exp(2, 15)
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await COMP.allocateTo(rewards.address, exp(86400 * 2 * MULTIPLIER, 18));
        await USDC.allocateTo(comet.address, exp(1e6, 6));
        await WBTC.allocateTo(alice.address, exp(1, 8));
        await WBTC.connect(alice).approve(comet.address, exp(1, 8));

        // allow manager, supply collateral, borrow
        await comet.connect(alice).allow(bob.address, true);
        await comet.connect(alice).supply(WBTC.address, exp(1, 8));
        await comet.connect(alice).withdraw(USDC.address, exp(10, 6));

        await fastForward(86400);

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
        expect(await USDC.balanceOf(alice.address)).to.be.equal(10e6);
        expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(10e6);
        const tx = await wait(
          rewards.connect(bob).claimTo(comet.address, alice.address, bob.address, true)
        );
        expect(await COMP.balanceOf(bob.address)).to.be.equal(
          (exp(86400 * 2, 18) * MULTIPLIER_FACTOR) / factorScale
        );

        // Note: First event is an ERC20 Transfer event
        expect(event(tx, 1)).to.be.deep.equal({
          RewardClaimed: {
            src: alice.address,
            recipient: bob.address,
            token: COMP.address,
            amount: (exp(86400 * 2, 18) * MULTIPLIER_FACTOR) / factorScale
          }
        });
      });

      it('can construct and claim rewards to target with downscale', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP, WBTC },
          users: [alice, bob]
        } = await makeProtocol({
          assets: defaultAssets(
            {},
            {
              COMP: { decimals: 5 }
            }
          ),
          baseMinForRewards: exp(10, 5),
          baseTrackingBorrowSpeed: exp(2, 15)
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await COMP.allocateTo(rewards.address, exp(86400 * 2 * MULTIPLIER, 5));
        await USDC.allocateTo(comet.address, exp(1e6, 6));
        await WBTC.allocateTo(alice.address, exp(1, 8));
        await WBTC.connect(alice).approve(comet.address, exp(1, 8));

        // allow manager, supply collateral, borrow
        await comet.connect(alice).allow(bob.address, true);
        await comet.connect(alice).supply(WBTC.address, exp(1, 8));
        await comet.connect(alice).withdraw(USDC.address, exp(10, 6));

        await fastForward(86400);

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
        expect(await USDC.balanceOf(alice.address)).to.be.equal(10e6);
        expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(10e6);
        const _tx = await wait(
          rewards.connect(bob).claimTo(comet.address, alice.address, bob.address, true)
        );
        expect(await COMP.balanceOf(bob.address)).to.be.equal(
          (exp(86400 * 2, 5) * MULTIPLIER_FACTOR) / factorScale
        );
      });

      it('can construct and claim rewards to target with same scale', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP, WBTC },
          users: [alice, bob]
        } = await makeProtocol({
          assets: defaultAssets(
            {},
            {
              COMP: { decimals: 6 }
            }
          ),
          baseMinForRewards: exp(10, 6),
          baseTrackingBorrowSpeed: exp(2, 15)
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await COMP.allocateTo(rewards.address, exp(86400 * 2 * MULTIPLIER, 6));
        await USDC.allocateTo(comet.address, exp(1e6, 6));
        await WBTC.allocateTo(alice.address, exp(1, 8));
        await WBTC.connect(alice).approve(comet.address, exp(1, 8));

        // allow manager, supply collateral, borrow
        await comet.connect(alice).allow(bob.address, true);
        await comet.connect(alice).supply(WBTC.address, exp(1, 8));
        await comet.connect(alice).withdraw(USDC.address, exp(10, 6));

        await fastForward(86400);

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
        expect(await USDC.balanceOf(alice.address)).to.be.equal(10e6);
        expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(10e6);
        const _tx = await wait(
          rewards.connect(bob).claimTo(comet.address, alice.address, bob.address, true)
        );
        expect(await COMP.balanceOf(bob.address)).to.be.equal(
          (exp(86400 * 2, 6) * MULTIPLIER_FACTOR) / factorScale
        );
      });

      it('does not allow claiming more than once', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP, WBTC },
          users: [alice, bob]
        } = await makeProtocol({
          baseMinForRewards: exp(10, 6),
          baseTrackingBorrowSpeed: exp(2, 15)
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await COMP.allocateTo(rewards.address, exp(86400 * 2 * MULTIPLIER, 18));
        await USDC.allocateTo(comet.address, exp(1e6, 6));
        await WBTC.allocateTo(alice.address, exp(1, 8));
        await WBTC.connect(alice).approve(comet.address, exp(1, 8));

        // allow manager, supply collateral, borrow
        await comet.connect(alice).allow(bob.address, true);
        await comet.connect(alice).supply(WBTC.address, exp(1, 8));
        await comet.connect(alice).withdraw(USDC.address, exp(10, 6));

        await fastForward(86400);

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
        expect(await USDC.balanceOf(alice.address)).to.be.equal(10e6);
        expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(10e6);
        const _tx0 = await wait(
          rewards.connect(bob).claimTo(comet.address, alice.address, bob.address, true)
        );
        const _tx1 = await wait(
          rewards.connect(bob).claimTo(comet.address, alice.address, bob.address, false)
        );
        expect(await COMP.balanceOf(bob.address)).to.be.equal(
          (exp(86400 * 2, 18) * MULTIPLIER_FACTOR) / factorScale
        );
      });

      it('fails if comet instance is not configured', async () => {
        const {
          comet,
          governor,
          users: [alice, bob]
        } = await makeProtocol();
        const { rewards } = await makeRewards({ governor, configs: [] });

        await comet.connect(alice).allow(bob.address, true);
        await expect(
          rewards.connect(bob).claim(comet.address, alice.address, true)
          //).to.be.revertedWith(`custom error 'NotSupported("${comet.address}")`);
        ).to.be.revertedWith(`custom error 'NotSupported(address)'`);
      });

      it('fails if not enough rewards in the pool to transfer', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP, WBTC },
          users: [alice, bob]
        } = await makeProtocol({
          baseMinForRewards: 10e6
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await USDC.allocateTo(comet.address, exp(1e6, 6));
        await WBTC.allocateTo(alice.address, exp(1, 8));
        await WBTC.connect(alice).approve(comet.address, exp(1, 8));

        // allow manager, supply collateral, borrow
        await comet.connect(alice).allow(bob.address, true);
        await comet.connect(alice).supply(WBTC.address, exp(1, 8));
        await comet.connect(alice).withdraw(USDC.address, exp(10, 6));

        await expect(
          rewards.connect(bob).claimTo(comet.address, alice.address, bob.address, true)
        ).to.be.revertedWith('ERC20: transfer amount exceeds balance');
      });

      it('fails if caller is not permitted to claim rewards for owner', async () => {
        const {
          comet,
          governor,
          tokens: { COMP },
          users: [alice]
        } = await makeProtocol({
          baseMinForRewards: exp(10, 6),
          baseTrackingBorrowSpeed: exp(2, 15)
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });
        await expect(
          rewards.claimTo(comet.address, alice.address, governor.address, true)
          //).to.be.revertedWith(`custom error 'NotPermitted("${governor.address}")'`);
        ).to.be.revertedWith(`custom error 'NotPermitted(address)'`);
      });
    });

    describe('getRewardOwed', () => {
      it('can construct and calculate rewards for owner with upscale', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP },
          users: [alice]
        } = await makeProtocol({
          assets: defaultAssets(
            {},
            {
              COMP: { decimals: 18 }
            }
          ),
          baseMinForRewards: 10e6
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await COMP.allocateTo(rewards.address, exp(86400 * MULTIPLIER, 18));
        await USDC.allocateTo(alice.address, 10e6);
        await USDC.connect(alice).approve(comet.address, 10e6);

        // supply once
        await comet.connect(alice).supply(USDC.address, 10e6);

        await fastForward(86400);
        await ethers.provider.send('evm_mine', []);

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);

        const { token, owed } = await rewards.callStatic.getRewardOwed(
          comet.address,
          alice.address
        );

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
        expect(token).to.be.equal(COMP.address);
        expect(owed).to.be.equal((exp(86400, 18) * MULTIPLIER_FACTOR) / factorScale);
      });

      it('can construct and calculate rewards for owner with downscale', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP },
          users: [alice]
        } = await makeProtocol({
          assets: defaultAssets(
            {},
            {
              COMP: { decimals: 2 }
            }
          )
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await COMP.allocateTo(rewards.address, exp(86400 * MULTIPLIER, 2));
        await USDC.allocateTo(alice.address, 10e6);
        await USDC.connect(alice).approve(comet.address, 10e6);

        // supply once
        await comet.connect(alice).supply(USDC.address, 10e6);

        await fastForward(86400);
        await ethers.provider.send('evm_mine', []);

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);

        const { token, owed } = await rewards.callStatic.getRewardOwed(
          comet.address,
          alice.address
        );

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
        expect(token).to.be.equal(COMP.address);
        expect(owed).to.be.equal((exp(86400, 2) * MULTIPLIER_FACTOR) / factorScale);
      });

      it('can construct and calculate rewards for owner with upscale with small rescale factor', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP },
          users: [alice]
        } = await makeProtocol({
          assets: defaultAssets(
            {},
            {
              COMP: { decimals: 7 }
            }
          )
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await COMP.allocateTo(rewards.address, exp(86400 * MULTIPLIER, 7));
        await USDC.allocateTo(alice.address, 10e6);
        await USDC.connect(alice).approve(comet.address, 10e6);

        // supply once
        await comet.connect(alice).supply(USDC.address, 10e6);

        await fastForward(86400);
        await ethers.provider.send('evm_mine', []);

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);

        const { token, owed } = await rewards.callStatic.getRewardOwed(
          comet.address,
          alice.address
        );

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
        expect(token).to.be.equal(COMP.address);
        expect(owed).to.be.equal((exp(86400, 7) * MULTIPLIER_FACTOR) / factorScale);
      });

      it('can construct and calculate rewards for owner with downscale with small rescale factor', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP },
          users: [alice]
        } = await makeProtocol({
          assets: defaultAssets(
            {},
            {
              COMP: { decimals: 5 }
            }
          )
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await COMP.allocateTo(rewards.address, exp(86400 * MULTIPLIER, 5));
        await USDC.allocateTo(alice.address, 10e6);
        await USDC.connect(alice).approve(comet.address, 10e6);

        // supply once
        await comet.connect(alice).supply(USDC.address, 10e6);

        await fastForward(86400);
        await ethers.provider.send('evm_mine', []);

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);

        const { token, owed } = await rewards.callStatic.getRewardOwed(
          comet.address,
          alice.address
        );

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
        expect(token).to.be.equal(COMP.address);
        expect(owed).to.be.equal((exp(86400, 5) * MULTIPLIER_FACTOR) / factorScale);
      });

      it('can construct and calculate rewards for owner with same scale', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP },
          users: [alice]
        } = await makeProtocol({
          assets: defaultAssets(
            {},
            {
              COMP: { decimals: 6 }
            }
          )
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await COMP.allocateTo(rewards.address, exp(86400 * MULTIPLIER, 6));
        await USDC.allocateTo(alice.address, 10e6);
        await USDC.connect(alice).approve(comet.address, 10e6);

        // supply once
        await comet.connect(alice).supply(USDC.address, 10e6);

        await fastForward(86400);
        await ethers.provider.send('evm_mine', []);

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);

        const { token, owed } = await rewards.callStatic.getRewardOwed(
          comet.address,
          alice.address
        );

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);
        expect(token).to.be.equal(COMP.address);
        expect(owed).to.be.equal((exp(86400, 6) * MULTIPLIER_FACTOR) / factorScale);
      });

      it('returns 0 owed if user already claimed', async () => {
        const {
          comet,
          governor,
          tokens: { USDC, COMP },
          users: [alice]
        } = await makeProtocol({
          baseMinForRewards: 10e6
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        // allocate and approve transfers
        await COMP.allocateTo(rewards.address, exp(86400 * MULTIPLIER, 18));
        await USDC.allocateTo(alice.address, 10e6);
        await USDC.connect(alice).approve(comet.address, 10e6);

        // supply once
        await comet.connect(alice).supply(USDC.address, 10e6);

        await fastForward(86400);

        expect(await COMP.balanceOf(alice.address)).to.be.equal(0);

        const _tx0 = await wait(rewards.claim(comet.address, alice.address, true));
        const { token, owed } = await rewards.callStatic.getRewardOwed(
          comet.address,
          alice.address
        );

        expect(await COMP.balanceOf(alice.address)).to.be.equal(
          (exp(86400, 18) * MULTIPLIER_FACTOR) / factorScale
        );
        expect(token).to.be.equal(COMP.address);
        expect(owed).to.be.equal(0);
      });

      it('fails if comet instance is not configured', async () => {
        const {
          comet,
          governor,
          users: [alice]
        } = await makeProtocol();
        const { rewards } = await makeRewards({ governor, configs: [] });

        await expect(
          rewards.getRewardOwed(comet.address, alice.address)
          //).to.be.revertedWith(`custom error 'NotSupported("${comet.address}")`);
        ).to.be.revertedWith(`custom error 'NotSupported(address)'`);
      });
    });

    describe('setRewardConfig', () => {
      it('allows governor to set rewards token with upscale', async () => {
        const {
          comet,
          governor,
          tokens: { COMP }
        } = await makeProtocol({
          assets: defaultAssets(
            {},
            {
              COMP: { decimals: 18 }
            }
          )
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        expect(objectify(await rewards.rewardConfig(comet.address))).to.be.deep.equal({
          token: COMP.address,
          rescaleFactor: exp(1, 12),
          shouldUpscale: true,
          multiplier: MULTIPLIER_FACTOR
        });
      });

      it('allows governor to set rewards token with downscale', async () => {
        const {
          comet,
          governor,
          tokens: { COMP }
        } = await makeProtocol({
          assets: defaultAssets(
            {},
            {
              COMP: { decimals: 2 }
            }
          )
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        expect(objectify(await rewards.rewardConfig(comet.address))).to.be.deep.equal({
          token: COMP.address,
          rescaleFactor: exp(1, 4),
          shouldUpscale: false,
          multiplier: MULTIPLIER_FACTOR
        });
      });

      it('allows governor to set rewards token with upscale with small rescale factor', async () => {
        const {
          comet,
          governor,
          tokens: { COMP }
        } = await makeProtocol({
          assets: defaultAssets(
            {},
            {
              COMP: { decimals: 7 }
            }
          )
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        expect(objectify(await rewards.rewardConfig(comet.address))).to.be.deep.equal({
          token: COMP.address,
          rescaleFactor: 10n,
          shouldUpscale: true,
          multiplier: MULTIPLIER_FACTOR
        });
      });

      it('allows governor to set rewards token with downscale with small rescale factor', async () => {
        const {
          comet,
          governor,
          tokens: { COMP }
        } = await makeProtocol({
          assets: defaultAssets(
            {},
            {
              COMP: { decimals: 5 }
            }
          )
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        expect(objectify(await rewards.rewardConfig(comet.address))).to.be.deep.equal({
          token: COMP.address,
          rescaleFactor: 10n,
          shouldUpscale: false,
          multiplier: MULTIPLIER_FACTOR
        });
      });

      it('allows governor to set rewards token with same scale', async () => {
        const {
          comet,
          governor,
          tokens: { COMP }
        } = await makeProtocol({
          assets: defaultAssets(
            {},
            {
              COMP: { decimals: 6 }
            }
          )
        });
        const { rewards } = await makeRewards({
          governor,
          configs: [[comet, COMP, MULTIPLIER_FACTOR]]
        });

        expect(objectify(await rewards.rewardConfig(comet.address))).to.be.deep.equal({
          token: COMP.address,
          rescaleFactor: 1n,
          shouldUpscale: true,
          multiplier: MULTIPLIER_FACTOR
        });
      });

      it('does not allow anyone but governor to set config', async () => {
        const {
          comet,
          governor,
          tokens: { COMP },
          users: [alice]
        } = await makeProtocol();
        const { rewards } = await makeRewards({ governor, configs: [] });

        expect(await rewards.governor()).to.be.equal(governor.address);
        await expect(
          rewards
            .connect(alice)
            .setRewardConfigWithMultiplier(comet.address, COMP.address, MULTIPLIER_FACTOR)
          //).to.be.revertedWith(`custom error 'NotPermitted("${alice.address}")'`);
        ).to.be.revertedWith(`custom error 'NotPermitted(address)'`);
      });
    });
  });
}
