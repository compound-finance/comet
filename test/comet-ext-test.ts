import { CometHarnessInterfaceExtendedAssetList, FaucetToken, NonStandardFaucetFeeToken } from '../build/types';
import { expect, exp, makeProtocol, setTotalsBasic } from './helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('CometExt', function () {
  let cometWithExtendedAssetList: CometHarnessInterfaceExtendedAssetList;
  let user: SignerWithAddress;
  let tokens: { [symbol: string]: FaucetToken | NonStandardFaucetFeeToken };

  beforeEach(async () => {
    ({
      cometWithExtendedAssetList,
      users: [user],
      tokens,
    } = await makeProtocol());

    // Set different indices
    await setTotalsBasic(cometWithExtendedAssetList, {
      baseSupplyIndex: 2e15,
      baseBorrowIndex: 3e15,
    });
  });

  it('returns factor scale', async () => {
    const factorScale = await cometWithExtendedAssetList.factorScale();
    expect(factorScale).to.eq(exp(1, 18));
  });

  it('returns price scale', async () => {
    const priceScale = await cometWithExtendedAssetList.priceScale();
    expect(priceScale).to.eq(exp(1, 8));
  });

  it('returns collateralBalance (in units of the collateral asset)', async () => {
    const { WETH } = tokens;

    await cometWithExtendedAssetList.setCollateralBalance(
      user.address,
      WETH.address,
      exp(5, 18)
    );

    const collateralBalanceOf = await cometWithExtendedAssetList.collateralBalanceOf(
      user.address,
      WETH.address
    );
    expect(collateralBalanceOf).to.eq(exp(5,18));
  });
});