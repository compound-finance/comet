import {
  Comet,
  ethers,
  expect,
  exp,
  factor,
  defaultAssets,
  makeProtocol,
  portfolio,
  wait,
} from './helpers';

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
});
