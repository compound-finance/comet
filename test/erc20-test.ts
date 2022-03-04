import { expect, makeProtocol } from './helpers';

describe('erc20', function () {
  it('has correct name', async () => {
    const { comet } = await makeProtocol();

    expect(await comet.name()).to.be.equal("Compound Comet");
  });

  it('has correct symbol', async () => {
    const { comet } = await makeProtocol();

    expect(await comet.symbol()).to.be.equal("📈BASE");
  });

  it('has correct decimals', async () => {
    const { comet } = await makeProtocol();

    expect(await comet.decimals()).to.be.equal(6);
  });

  it.skip('has correct totalSupply', async () => {
    // XXX
  });

  it.skip('calculates balanceOf', async () => {
    // XXX
  });

  it.skip('calculates borrowBalanceOf', async () => {
    // XXX
  });

  it.skip('performs ERC20 transfer of base', async () => {
    // XXX
    // XXX emits Transfer
  });

  it.skip('performs ERC20 transferFrom of base with approval', async () => {
    // XXX
    // XXX emits Approval
    // XXX check allowance()
  });

  it.skip('reverts ERC20 transferFrom without approval', async () => {
    // XXX
  });

  it.skip('reverts ERC20 transferFrom with revoked approval', async () => {
    // XXX
    // XXX emits Approval
    // XXX check allowance
  });
});
