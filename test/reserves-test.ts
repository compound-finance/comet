import { expect, makeProtocol, wait } from './helpers';

describe('getReserves', function () {
  it('calculates 0 reserves', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens } = protocol;
    const { USDC } = tokens;
    await USDC.allocateTo(comet.address, 100);

    const t0 = await comet.totalsBasic();
    const t1 = Object.assign({}, t0, {
        totalSupplyBase: 100n,
        totalBorrowBase: 0n,
    });
    await wait(comet.setTotalsBasic(t1));

    const reserves = await comet.getReserves();

    expect(reserves).to.be.equal(0n);
  });

  it('calculates positive reserves', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens } = protocol;
    const { USDC } = tokens;
    await USDC.allocateTo(comet.address, 100);

    const t0 = await comet.totalsBasic();
    const t1 = Object.assign({}, t0, {
        totalSupplyBase: 100n,
        totalBorrowBase: 50n,
    });
    await wait(comet.setTotalsBasic(t1));

    const reserves = await comet.getReserves();

    expect(reserves).to.be.equal(50n);
  });

  it('calculates negative reserves', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens } = protocol;
    const { USDC } = tokens;

    // Protocol holds no USDC

    const t0 = await comet.totalsBasic();
    const t1 = Object.assign({}, t0, {
        totalSupplyBase: 100n,
        totalBorrowBase: 0n,
    });
    await wait(comet.setTotalsBasic(t1));

    const reserves = await comet.getReserves();

    expect(reserves).to.be.equal(-100n);
  });
});
