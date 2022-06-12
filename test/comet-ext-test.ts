import { CometHarnessInterface, FaucetToken } from '../build/types';
import { expect, exp, makeProtocol, setTotalsBasic } from './helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('CometExt', function () {
  let comet: CometHarnessInterface;
  let user: SignerWithAddress;
  let tokens: { [symbol: string]: FaucetToken };

  beforeEach(async () => {
    ({
      comet,
      users: [user],
      tokens,
    } = await makeProtocol());

    // Set different indices
    await setTotalsBasic(comet, {
      baseSupplyIndex: 2e15,
      baseBorrowIndex: 3e15,
    });
  });

  it('returns factor scale', async () => {
    const factorScale = await comet.factorScale();
    expect(factorScale).to.eq(exp(1, 18));
  });

  it('returns price scale', async () => {
    const priceScale = await comet.priceScale();
    expect(priceScale).to.eq(exp(1, 8));
  });

  it('returns collateralBalance (in units of the collateral asset)', async () => {
    const { WETH } = tokens;

    await comet.setCollateralBalance(
      user.address,
      WETH.address,
      exp(5, 18)
    );

    const collateralBalanceOf = await comet.collateralBalanceOf(
      user.address,
      WETH.address
    );
    expect(collateralBalanceOf).to.eq(exp(5,18));
  });
});