import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { FaucetToken__factory, MockedOracle__factory, Comet, Comet__factory } from '../build/types';

let comet: Comet;
let admin: SignerWithAddress;
let signer: SignerWithAddress;
let manager: SignerWithAddress;
let domain;
let validNonce;
let validExpiry;

const types = {
  Authorization: [
    { name: 'manager', type: 'address' },
    { name: '_isAllowed', type: 'bool' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
  ],
};

describe('Comet#allow', function () {
  beforeEach(async () => {
    [admin, signer, manager] = await ethers.getSigners();

    const FaucetTokenFactory = (await ethers.getContractFactory(
      'FaucetToken'
    )) as FaucetToken__factory;
    const token = await FaucetTokenFactory.deploy(100000, 'DAI', 18, 'DAI');
    await token.deployed();

    const OracleFactory = (await ethers.getContractFactory(
      'MockedOracle'
    )) as MockedOracle__factory;
    const oracle = await OracleFactory.deploy();
    await oracle.deployed();

    const CometFactory = (await ethers.getContractFactory('Comet')) as Comet__factory;
    comet = await CometFactory.deploy({
      governor: admin.address,
      priceOracle: oracle.address,
      baseToken: token.address,
      assetInfo: [],
    });
    await comet.deployed();

    domain = {
      name: await comet.NAME(),
      version: await comet.VERSION(),
      chainId: 1337, // pull from hre
      verifyingContract: comet.address,
    };
    validNonce = await comet.userNonce(signer.address);
    const blockNumber = await ethers.provider.getBlockNumber();
    const timestamp = (await ethers.provider.getBlock(blockNumber)).timestamp;
    validExpiry = timestamp + 10;
  });

  it('authorizes with a valid signature', async () => {
    const value = {
      manager: manager.address,
      _isAllowed: true,
      nonce: validNonce,
      expiry: validExpiry,
    };
    const signature = await signer._signTypedData(domain, types, value);

    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    await comet
      .connect(manager)
      .allowBySig(manager.address, true, validNonce, validExpiry, signature);

    // authorizes manager
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.true;

    // increments nonce
    expect(await comet.userNonce(signer.address)).to.equal(validNonce.add(1));
  });

  it('fails for invalid signatures', async () => {
    const [_admin, _signer, manager] = await ethers.getSigners();
    const alteredSignature = '0xbadbad';

    await expect(
      comet
        .connect(manager)
        .allowBySig(manager.address, true, validNonce, validExpiry, alteredSignature)
    ).to.be.revertedWith('ECDSA: invalid signature');
  });

  it('fails for invalid nonce', async () => {
    const invalidNonce = validNonce.add(1);

    const value = {
      manager: manager.address,
      _isAllowed: true,
      nonce: invalidNonce,
      expiry: validExpiry,
    };
    const signature = await signer._signTypedData(domain, types, value);

    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    await expect(
      comet.connect(manager).allowBySig(manager.address, true, invalidNonce, validExpiry, signature)
    ).to.be.revertedWith('Invalid nonce');

    // does not authorize
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;
    // does not update nonce
    expect(await comet.userNonce(signer.address)).to.equal(validNonce);
  });

  it('rejects a repeated message', async () => {
    const value = {
      manager: manager.address,
      _isAllowed: true,
      nonce: validNonce,
      expiry: validExpiry,
    };
    const signature = await signer._signTypedData(domain, types, value);

    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    // valid call
    await comet
      .connect(manager)
      .allowBySig(manager.address, true, validNonce, validExpiry, signature);

    // repeated call
    await expect(
      comet.connect(manager).allowBySig(manager.address, true, validNonce, validExpiry, signature)
    ).to.be.revertedWith('Invalid nonce');
  });

  it('fails for invalid expiry', async () => {
    const blockNumber = await ethers.provider.getBlockNumber();
    const timestamp = (await ethers.provider.getBlock(blockNumber)).timestamp;
    const invalidExpiry = timestamp - 1;

    const value = {
      manager: manager.address,
      _isAllowed: true,
      nonce: validNonce,
      expiry: invalidExpiry,
    };
    const signature = await signer._signTypedData(domain, types, value);

    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;

    await expect(
      comet.connect(manager).allowBySig(manager.address, true, validNonce, invalidExpiry, signature)
    ).to.be.revertedWith('Signed transaction expired');

    // does not authorize
    expect(await comet.isAllowed(signer.address, manager.address)).to.be.false;
  });
});
