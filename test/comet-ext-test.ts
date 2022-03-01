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
});
