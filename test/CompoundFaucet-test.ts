// Unit tests for CompoundFaucet — the one-shot, fixed-amount test-fund
// drip used by compound-on-rome-demo's /faucet page.
//
// Differs from Compound's stock Fauceteer (0.01% per-token-per-day drip).
// This faucet:
//   - Drips a FIXED amount per registered token (set by owner at addToken)
//   - Drips a FIXED native gas amount (set at construction)
//   - Allows AT MOST ONE claim per address ever (mapping claimed[user])
//   - Uses IERC20.transfer (not mint) because compound's SPL_ERC20_cached
//     wrappers have no public mint
import { expect, exp, makeProtocol } from './helpers';
import { ethers } from 'hardhat';

describe('CompoundFaucet', () => {
  async function deployFaucet({ gasDrop }: { gasDrop: bigint }) {
    const [deployer, user] = await ethers.getSigners();
    const Faucet = await ethers.getContractFactory('CompoundFaucet');
    const faucet = await Faucet.connect(deployer).deploy(gasDrop, { value: gasDrop });
    await faucet.deployed();
    return { faucet, deployer, user };
  }

  it('lets owner register tokens with a per-claim drop amount', async () => {
    const protocol = await makeProtocol();
    const { faucet, deployer } = await deployFaucet({ gasDrop: 0n });
    const token = protocol.tokens['USDC'];
    const drop = exp(100, 6);
    await faucet.connect(deployer).addToken(token.address, drop);
    expect((await faucet.tokenDrop(token.address)).toBigInt()).to.equal(drop);
    expect(await faucet.tokens(0)).to.equal(token.address);
  });

  it('reverts addToken when called by non-owner', async () => {
    const protocol = await makeProtocol();
    const { faucet } = await deployFaucet({ gasDrop: 0n });
    const [, , notOwner] = await ethers.getSigners();
    const token = protocol.tokens['USDC'];
    await expect(
      faucet.connect(notOwner).addToken(token.address, '1'),
    ).to.be.revertedWith('CompoundFaucet: not owner');
  });

  it('claim sends gas + token drops + flips claimed mapping', async () => {
    const protocol = await makeProtocol();
    const { faucet, deployer, user } = await deployFaucet({ gasDrop: exp(10, 18) });
    const token = protocol.tokens['USDC'];
    const drop = exp(100, 6);
    await faucet.connect(deployer).addToken(token.address, drop);

    // Pre-fund the faucet with enough token balance for one claim. The
    // FaucetToken in tests has a public allocateTo so we drip into the
    // faucet directly without consuming the deployer's allowance.
    await token.allocateTo(faucet.address, drop);

    const gasBefore = (await ethers.provider.getBalance(user.address)).toBigInt();
    const tokenBefore = (await token.balanceOf(user.address)).toBigInt();

    const tx = await faucet.connect(user).claim();
    const receipt = await tx.wait();
    const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice).toBigInt();

    const gasAfter = (await ethers.provider.getBalance(user.address)).toBigInt();
    const tokenAfter = (await token.balanceOf(user.address)).toBigInt();
    expect(gasAfter).to.equal(gasBefore + exp(10, 18) - gasCost);
    expect(tokenAfter).to.equal(tokenBefore + drop);
    expect(await faucet.claimed(user.address)).to.equal(true);
  });

  it('second claim from the same address reverts "already claimed"', async () => {
    const protocol = await makeProtocol();
    const { faucet, deployer, user } = await deployFaucet({ gasDrop: exp(1, 18) });
    const token = protocol.tokens['USDC'];
    const drop = exp(100, 6);
    await faucet.connect(deployer).addToken(token.address, drop);
    await token.allocateTo(faucet.address, drop * 2n);

    await faucet.connect(user).claim();
    await expect(faucet.connect(user).claim()).to.be.revertedWith('CompoundFaucet: already claimed');
  });

  it('emits Claimed(user, gas, tokenCount) on success', async () => {
    const protocol = await makeProtocol();
    const { faucet, deployer, user } = await deployFaucet({ gasDrop: 0n });
    const token = protocol.tokens['USDC'];
    const drop = exp(100, 6);
    await faucet.connect(deployer).addToken(token.address, drop);
    await token.allocateTo(faucet.address, drop);
    await expect(faucet.connect(user).claim())
      .to.emit(faucet, 'Claimed')
      .withArgs(user.address, 0, 1);
  });

  it('tokenList returns all registered tokens', async () => {
    const protocol = await makeProtocol();
    const { faucet, deployer } = await deployFaucet({ gasDrop: 0n });
    const a = protocol.tokens['USDC'];
    const b = protocol.tokens['COMP'] ?? protocol.tokens['WETH'];
    await faucet.connect(deployer).addToken(a.address, '1');
    await faucet.connect(deployer).addToken(b.address, '1');
    const list = await faucet.tokenList();
    expect(list).to.have.lengthOf(2);
    expect(list[0]).to.equal(a.address);
    expect(list[1]).to.equal(b.address);
  });
});
