import { scenario } from './context/CometContext';
import { expect } from 'chai';

scenario(
  'Comet#allowBySig > allows a user to authorize a manager by signature',
  {},
  async ({ comet, actors }, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    const nonce = await comet.userNonce(albert.address);
    const expiry = (await world.timestamp()) + 10;
    const chainId = await world.chainId();

    const signature = await albert.signAuthorization({
      managerAddress: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      chainId,
    });

    await betty.allowBySig({
      isAllowed: true,
      nonce,
      expiry,
      signature,
    });

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.true;
  }
);

scenario('Comet#allowBySig fails for invalid signatures', {}, async ({ comet, actors }, world) => {
  const { albert, betty } = actors;

  expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

  const nonce = await comet.userNonce(albert.address);
  const expiry = (await world.timestamp()) + 10;

  await expect(
    betty.allowBySig({
      isAllowed: true,
      nonce,
      expiry,
      signature: '0xbadbad',
    })
  ).to.be.revertedWith('ECDSA: invalid signature length');
});

scenario('Comet#allowBySig fails for invalid nonce', {}, async ({ comet, actors }, world) => {
  const { albert, betty } = actors;

  expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

  const nonce = await comet.userNonce(albert.address);
  const invalidNonce = nonce.add(1);
  const expiry = (await world.timestamp()) + 10;
  const chainId = await world.chainId();

  const signature = await albert.signAuthorization({
    managerAddress: betty.address,
    isAllowed: true,
    nonce: invalidNonce,
    expiry,
    chainId,
  });

  await expect(
    betty.allowBySig({
      isAllowed: true,
      nonce: invalidNonce,
      expiry,
      signature,
    })
  ).to.be.revertedWith('Invalid nonce');
});

scenario('Comet#allowBySig rejects a repeated message', {}, async ({ comet, actors }, world) => {
  const { albert, betty } = actors;

  expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

  const nonce = await comet.userNonce(albert.address);
  const expiry = (await world.timestamp()) + 10;
  const chainId = await world.chainId();

  const signature = await albert.signAuthorization({
    managerAddress: betty.address,
    isAllowed: true,
    nonce,
    expiry,
    chainId,
  });

  // valid call
  await betty.allowBySig({
    isAllowed: true,
    nonce,
    expiry,
    signature,
  });

  // repeated call
  await expect(
    betty.allowBySig({
      isAllowed: true,
      nonce,
      expiry,
      signature,
    })
  ).to.be.revertedWith('Invalid nonce');
});

scenario('Comet#allowBySig fails for invalid expiry', {}, async ({ comet, actors }, world) => {
  const { albert, betty } = actors;

  expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

  const nonce = await comet.userNonce(albert.address);
  const invalidExpiry = (await world.timestamp()) - 1;
  const chainId = await world.chainId();

  const signature = await albert.signAuthorization({
    managerAddress: betty.address,
    isAllowed: true,
    nonce,
    expiry: invalidExpiry,
    chainId,
  });

  await expect(
    betty.allowBySig({
      isAllowed: true,
      nonce,
      expiry: invalidExpiry,
      signature,
    })
  ).to.be.revertedWith('Signed transaction expired');
});
