import { ethers, expect, makeProtocol } from './helpers';

describe('updateAssetsIn', function () {
  it('sets isInAsset=true when initialUserBalance=0 and finalUserBalance>0', async () => {
    const { comet, tokens } = await makeProtocol();
    const [_governor, _pauseGuardian, user] = await ethers.getSigners();

    const compAddress = tokens['COMP'].address;
    expect(await comet.isInAsset(user.address, compAddress)).to.be.false;
    await comet.updateAssetsIn(user.address, compAddress, 0, 1);
    expect(await comet.isInAsset(user.address, compAddress)).to.be.true;

    const wethAddress = tokens['WETH'].address;
    expect(await comet.isInAsset(user.address, wethAddress)).to.be.false;
    await comet.updateAssetsIn(user.address, wethAddress, 0, 100_000);
    expect(await comet.isInAsset(user.address, wethAddress)).to.be.true;

    const wbtcAddress = tokens['WBTC'].address;
    expect(await comet.isInAsset(user.address, wbtcAddress)).to.be.false;
    await comet.updateAssetsIn(user.address, wbtcAddress, 0, 100_000_000);
    expect(await comet.isInAsset(user.address, wbtcAddress)).to.be.true;
  });

  it('does not change state when both initialUserBalance and finalUserBalance are 0', async () => {
    const { comet, tokens } = await makeProtocol();
    const [_governor, _pauseGuardian, user] = await ethers.getSigners();

    const compAddress = tokens['COMP'].address;
    expect(await comet.isInAsset(user.address, compAddress)).to.be.false;
    await comet.updateAssetsIn(user.address, compAddress, 0, 0);
    expect(await comet.isInAsset(user.address, compAddress)).to.be.false;
  });

  it('does not change state when both initialUserBalance and finalUserBalance > 0', async () => {
    const { comet, tokens } = await makeProtocol();
    const [_governor, _pauseGuardian, user] = await ethers.getSigners();

    const wethAddress = tokens['WETH'].address;

    // enters asset
    await comet.updateAssetsIn(user.address, wethAddress, 0, 100_000);
    expect(await comet.isInAsset(user.address, wethAddress)).to.be.true;

    // still in asset
    await comet.updateAssetsIn(user.address, wethAddress, 100_000, 999);
    expect(await comet.isInAsset(user.address, wethAddress)).to.be.true;
  });

  it('set isInAsset=false when initialUserBalance > 0 and finalUserBalance=0', async () => {
    const { comet, tokens } = await makeProtocol();
    const [_governor, _pauseGuardian, user] = await ethers.getSigners();

    const compAddress = tokens['COMP'].address;
    // initially not in asset
    expect(await comet.isInAsset(user.address, compAddress)).to.be.false;

    // enters asset
    await comet.updateAssetsIn(user.address, compAddress, 0, 1);
    expect(await comet.isInAsset(user.address, compAddress)).to.be.true;

    // leaves asset
    await comet.updateAssetsIn(user.address, compAddress, 1, 0);
    expect(await comet.isInAsset(user.address, compAddress)).to.be.false;
  });
});
