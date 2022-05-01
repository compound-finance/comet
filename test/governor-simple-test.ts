import { GovernorSimple__factory } from '../build/types';
import { ethers } from 'hardhat';
import { expect } from 'chai';

async function buildGovernorSimple() {
  const GovernorSimpleFactory = (await ethers.getContractFactory('GovernorSimple')) as GovernorSimple__factory;
  const governorSimple = await GovernorSimpleFactory.deploy();
  await governorSimple.deployed();
  return governorSimple;
}

describe('GovernorSimple', function () {
  it('adds a new admin', async () => {
    const [alice, bob] = await ethers.getSigners();
    const governorSimple = await buildGovernorSimple();
    await governorSimple.initialize(
      ethers.constants.AddressZero,
      [alice.address]
    );

    expect(await governorSimple.isAdmin(bob.address)).to.be.false;

    await governorSimple.connect(alice).addAdmin(bob.address);

    expect(await governorSimple.isAdmin(bob.address)).to.be.true;
  });

  it('removes an existing admin', async () => {
    const [alice, bob] = await ethers.getSigners();
    const governorSimple = await buildGovernorSimple();
    await governorSimple.initialize(
      ethers.constants.AddressZero,
      [alice.address, bob.address]
    );

    expect(await governorSimple.isAdmin(bob.address)).to.be.true;

    await governorSimple.connect(alice).removeAdmin(bob.address);

    expect(await governorSimple.isAdmin(bob.address)).to.be.false;
  });
});