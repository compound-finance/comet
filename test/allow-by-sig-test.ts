import { Comet, ethers, expect, exp, makeProtocol, wait } from './helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, Signature } from 'ethers';

let comet: Comet;
let admin: SignerWithAddress;
let pauseGuardian: SignerWithAddress;
let signer: SignerWithAddress;
let manager: SignerWithAddress;
let domain;
let signature: Signature;
let signatureArgs: {
  owner: string;
  manager: string;
  isAllowed: boolean;
  nonce: BigNumber;
  expiry: number;
};

const types = {
  Authorization: [
    { name: 'owner', type: 'address' },
    { name: 'manager', type: 'address' },
    { name: 'isAllowed', type: 'bool' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
  ],
};

describe('allowBySig', function () {
  beforeEach(async () => {
    comet = (await makeProtocol()).comet;
    [admin, pauseGuardian, signer, manager] = await ethers.getSigners();

    domain = {
      name: await comet.name(),
      version: await comet.version(),
      chainId: 1337,
      verifyingContract: comet.address,
    };
    const blockNumber = await ethers.provider.getBlockNumber();
    const timestamp = (await ethers.provider.getBlock(blockNumber)).timestamp;

    signatureArgs = {
      owner: signer.address,
      manager: manager.address,
      isAllowed: true,
      nonce: await comet.userNonce(signer.address),
      expiry: timestamp + 10,
    };

    const rawSignature = await signer._signTypedData(domain, types, signatureArgs);
    signature = ethers.utils.splitSignature(rawSignature);
  });

  it('authorizes with a valid signature', async () => {
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    await comet
      .connect(manager)
      .allowBySig(
        signatureArgs.owner,
        signatureArgs.manager,
        signatureArgs.isAllowed,
        signatureArgs.nonce,
        signatureArgs.expiry,
        signature.v,
        signature.r,
        signature.s
      );

    // authorizes manager
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.true;

    // increments nonce
    expect(await comet.userNonce(signer.address)).to.equal(signatureArgs.nonce.add(1));
  });

  it('fails if owner argument is altered', async () => {
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    const invalidOwnerAddress = pauseGuardian.address;

    await expect(
      comet.connect(manager).allowBySig(
        invalidOwnerAddress, // altered owner
        signatureArgs.manager,
        signatureArgs.isAllowed,
        signatureArgs.nonce,
        signatureArgs.expiry,
        signature.v,
        signature.r,
        signature.s
      )
    ).to.be.revertedWith('owner is not signatory');

    // does not authorize
    expect(await comet.isAllowed(invalidOwnerAddress, manager.address)).to.be.false;

    // does not alter signer nonce
    expect(await comet.userNonce(signer.address)).to.equal(signatureArgs.nonce);
  });

  it('fails if manager argument is altered', async () => {
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    const invalidManagerAddress = pauseGuardian.address;

    await expect(
      comet.connect(manager).allowBySig(
        signatureArgs.owner,
        invalidManagerAddress, // altered manager
        signatureArgs.isAllowed,
        signatureArgs.nonce,
        signatureArgs.expiry,
        signature.v,
        signature.r,
        signature.s
      )
    ).to.be.revertedWith('owner is not signatory');

    // does not authorize
    expect(await comet.isAllowed(signer.address, invalidManagerAddress)).to.be.false;

    // does not alter signer nonce
    expect(await comet.userNonce(signer.address)).to.equal(signatureArgs.nonce);
  });

  it('fails if isAllowed argument is altered', async () => {
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    await expect(
      comet.connect(manager).allowBySig(
        signatureArgs.owner,
        signatureArgs.manager,
        !signatureArgs.isAllowed, // altered isAllowed
        signatureArgs.nonce,
        signatureArgs.expiry,
        signature.v,
        signature.r,
        signature.s
      )
    ).to.be.revertedWith('owner is not signatory');

    // does not authorize
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    // does not alter signer nonce
    expect(await comet.userNonce(signer.address)).to.equal(signatureArgs.nonce);
  });

  it('fails if nonce argument is altered', async () => {
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    await expect(
      comet.connect(manager).allowBySig(
        signatureArgs.owner,
        signatureArgs.manager,
        signatureArgs.isAllowed,
        signatureArgs.nonce.add(1), // altered nonce
        signatureArgs.expiry,
        signature.v,
        signature.r,
        signature.s
      )
    ).to.be.revertedWith('owner is not signatory');

    // does not authorize
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    // does not alter signer nonce
    expect(await comet.userNonce(signer.address)).to.equal(signatureArgs.nonce);
  });

  it('fails if expiry argument is altered', async () => {
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    await expect(
      comet.connect(manager).allowBySig(
        signatureArgs.owner,
        signatureArgs.manager,
        signatureArgs.isAllowed,
        signatureArgs.nonce,
        signatureArgs.expiry + 100, // altered expiry
        signature.v,
        signature.r,
        signature.s
      )
    ).to.be.revertedWith('owner is not signatory');

    // does not authorize
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    // does not alter signer nonce
    expect(await comet.userNonce(signer.address)).to.equal(signatureArgs.nonce);
  });

  it('fails if signature contains invalid nonce', async () => {
    const invalidNonce = signatureArgs.nonce.add(1);
    const rawSignature = await signer._signTypedData(domain, types, {
      ...signatureArgs,
      nonce: invalidNonce,
    });
    const signatureWithInvalidNonce = ethers.utils.splitSignature(rawSignature);

    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    await expect(
      comet
        .connect(manager)
        .allowBySig(
          signatureArgs.owner,
          signatureArgs.manager,
          signatureArgs.isAllowed,
          invalidNonce,
          signatureArgs.expiry,
          signatureWithInvalidNonce.v,
          signatureWithInvalidNonce.r,
          signatureWithInvalidNonce.s
        )
    ).to.be.revertedWith('invalid nonce');

    // does not authorize
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;
    // does not update nonce
    expect(await comet.userNonce(signer.address)).to.equal(signatureArgs.nonce);
  });

  it('rejects a repeated message', async () => {
    // valid call
    await comet
      .connect(manager)
      .allowBySig(
        signatureArgs.owner,
        signatureArgs.manager,
        signatureArgs.isAllowed,
        signatureArgs.nonce,
        signatureArgs.expiry,
        signature.v,
        signature.r,
        signature.s
      );

    // repeated call
    await expect(
      comet
        .connect(manager)
        .allowBySig(
          signatureArgs.owner,
          signatureArgs.manager,
          signatureArgs.isAllowed,
          signatureArgs.nonce,
          signatureArgs.expiry,
          signature.v,
          signature.r,
          signature.s
        )
    ).to.be.revertedWith('invalid nonce');
  });

  it('fails if signature expiry has passed', async () => {
    const blockNumber = await ethers.provider.getBlockNumber();
    const timestamp = (await ethers.provider.getBlock(blockNumber)).timestamp;
    const invalidExpiry = timestamp - 1;

    const expiredSignatureArgs = {
      ...signatureArgs,
      expiry: invalidExpiry,
    };
    const rawSignature = await signer._signTypedData(domain, types, expiredSignatureArgs);
    const expiredSignature = ethers.utils.splitSignature(rawSignature);

    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    await expect(
      comet
        .connect(manager)
        .allowBySig(
          expiredSignatureArgs.owner,
          expiredSignatureArgs.manager,
          expiredSignatureArgs.isAllowed,
          expiredSignatureArgs.nonce,
          expiredSignatureArgs.expiry,
          expiredSignature.v,
          expiredSignature.r,
          expiredSignature.s
        )
    ).to.be.revertedWith('signed transaction expired');

    // does not authorize
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    // does not update nonce
    expect(await comet.userNonce(signer.address)).to.equal(signatureArgs.nonce);
  });

  it('fails if v not in {27,28}', async () => {
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    await expect(
      comet
        .connect(manager)
        .allowBySig(
          signatureArgs.owner,
          signatureArgs.manager,
          signatureArgs.isAllowed,
          signatureArgs.nonce,
          signatureArgs.expiry,
          26,
          signature.r,
          signature.s
        )
    ).to.be.revertedWith('invalid value: v');

    // does not authorize
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    // does not update nonce
    expect(await comet.userNonce(signer.address)).to.equal(signatureArgs.nonce);
  });

  it('fails if s is too high', async () => {
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    // 1 greater than the max value of s
    const invalidS = '0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A1';

    await expect(
      comet
        .connect(manager)
        .allowBySig(
          signatureArgs.owner,
          signatureArgs.manager,
          signatureArgs.isAllowed,
          signatureArgs.nonce,
          signatureArgs.expiry,
          signature.v,
          signature.r,
          invalidS
        )
    ).to.be.revertedWith('invalid value: s');

    // does not authorize
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    // does not update nonce
    expect(await comet.userNonce(signer.address)).to.equal(signatureArgs.nonce);
  });
});
