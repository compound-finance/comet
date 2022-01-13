import { ethers, expect, makeProtocol } from './helpers';

describe('updateAssetsIn', function () {
  it("adds asset to user's asset list when initialUserBalance=0 and finalUserBalance>0", async () => {
    const { comet, tokens } = await makeProtocol();
    const [_governor, _pauseGuardian, user] = await ethers.getSigners();
    const compAddress = tokens['COMP'].address;
    const wethAddress = tokens['WETH'].address;
    const wbtcAddress = tokens['WBTC'].address;

    expect(await comet.getAssetList(user.address)).to.be.empty;

    await comet.updateAssetsInExternal(user.address, compAddress, 0, 1);
    expect(await comet.getAssetList(user.address)).to.deep.equal([compAddress]);

    await comet.updateAssetsInExternal(user.address, wethAddress, 0, 100_000);
    expect(await comet.getAssetList(user.address)).to.deep.equal([compAddress, wethAddress]);

    await comet.updateAssetsInExternal(user.address, wbtcAddress, 0, 100_000_000);
    expect(await comet.getAssetList(user.address)).to.deep.equal([
      compAddress,
      wethAddress,
      wbtcAddress,
    ]);
  });

  it('does not change state when both initialUserBalance and finalUserBalance are 0', async () => {
    const { comet, tokens } = await makeProtocol();
    const [_governor, _pauseGuardian, user] = await ethers.getSigners();
    const compAddress = tokens['COMP'].address;

    expect(await comet.getAssetList(user.address)).to.be.empty;

    await comet.updateAssetsInExternal(user.address, compAddress, 0, 0);

    expect(await comet.getAssetList(user.address)).to.be.empty;
  });

  it('does not change state when both initialUserBalance and finalUserBalance > 0', async () => {
    const { comet, tokens } = await makeProtocol();
    const [_governor, _pauseGuardian, user] = await ethers.getSigners();
    const wethAddress = tokens['WETH'].address;

    // enters asset
    await comet.updateAssetsInExternal(user.address, wethAddress, 0, 100_000);
    expect(await comet.getAssetList(user.address)).to.deep.equal([wethAddress]);

    // still in asset
    await comet.updateAssetsInExternal(user.address, wethAddress, 100_000, 999);
    expect(await comet.getAssetList(user.address)).to.deep.equal([wethAddress]);
  });

  it('removes asset from asset list when initialUserBalance > 0 and finalUserBalance=0', async () => {
    const { comet, tokens } = await makeProtocol();
    const [_governor, _pauseGuardian, user] = await ethers.getSigners();
    const compAddress = tokens['COMP'].address;

    // initially not in asset
    expect(await comet.getAssetList(user.address)).to.be.empty;

    // enters asset
    await comet.updateAssetsInExternal(user.address, compAddress, 0, 1);
    expect(await comet.getAssetList(user.address)).to.deep.equal([compAddress]);

    // leaves asset
    await comet.updateAssetsInExternal(user.address, compAddress, 1, 0);
    expect(await comet.getAssetList(user.address)).to.be.empty;
  });

  it('reverts for non-existent asset address', async () => {
    const { comet } = await makeProtocol();
    const [_governor, pauseGuardian, user] = await ethers.getSigners();

    const erroneousAssetAddress = pauseGuardian.address;

    await expect(
      comet.updateAssetsInExternal(user.address, erroneousAssetAddress, 0, 100)
    ).to.be.revertedWith('asset not found');
  });
});
