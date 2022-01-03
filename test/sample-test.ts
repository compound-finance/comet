import { expect } from 'chai';
import { ethers } from 'hardhat';

import { Greeter__factory, Greeter } from '../build/types';

describe('Greeter', function () {
  it("Should return the new greeting once it's changed", async function () {
    const greeterFactory = (await ethers.getContractFactory(
      'Greeter'
    )) as Greeter__factory;
    const greeter: Greeter = await greeterFactory.deploy('Hello, world!');
    await greeter.deployed();

    expect(await greeter.greet()).to.equal('Hello, world!');

    const setGreetingTx = await greeter.setGreeting('Hola, mundo!');

    // wait until the transaction is mined
    await setGreetingTx.wait();

    expect(await greeter.greet()).to.equal('Hola, mundo!');
  });
});
