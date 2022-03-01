import { expect, exp, makeProtocol } from './helpers';

describe('CometExt', function () {
  it('returns factor scale', async () => {
    const { comet } = await makeProtocol();
    const factorScale = await comet.factorScale();
    await expect(factorScale).to.eq(exp(1, 18));
  });

  it('returns price scale', async () => {
    const { comet } = await makeProtocol();
    const priceScale = await comet.priceScale();
    await expect(priceScale).to.eq(exp(1, 8));
  });

  it('returns totalSupply', async () => {
    const { comet } = await makeProtocol();

    let totalsBasic = await comet.totalsBasic();
    totalsBasic = Object.assign({}, totalsBasic, {
      totalSupplyBase: 100e6,
    });
    await comet.setTotalsBasic(totalsBasic);

    const totalSupply = await comet.totalSupply();

    await expect(totalSupply).to.eq(100e6);
  });
});
