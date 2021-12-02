import { expect } from 'chai';
import { ethers } from 'hardhat';

import { Greeter__factory, Greeter } from '../build/types'

describe('Greeter', function () {
  it('Should return the new greeting once it\'s changed', async function () {
    const greeterFactory = await ethers.getContractFactory('Greeter') as Greeter__factory;
    const greeter: Greeter = await greeterFactory.deploy('Hello, world!');
    await greeter.deployed();

    expect(await greeter.greet()).to.equal('Hello, world!');

    const setGreetingTx = await greeter.setGreeting('Hola, mundo!');

    // wait until the transaction is mined
    await setGreetingTx.wait();

    expect(await greeter.greet()).to.equal('Hola, mundo!');
  });
});

describe("Protocol", function() {
  it('Should return the new greeting once it\'s changed', async function () {


    const Config = await ethers.getContractFactory('Config');
    const config = await Config.deploy(100000, 200000);
    await config.deployed();
    console.log('Config deployed to:', config.address);

    const [admin] = await ethers.getSigners();
    console.log("admin = ", admin.address);

    const Proxy = await ethers.getContractFactory('TransparentUpgradeableProxy');
    const proxy = await Proxy.deploy(config.address, admin.address, []);
    await proxy.deployed();
    console.log('Proxy deployed to:', proxy.address);

    const Protocol = await ethers.getContractFactory('Protocol');
    const protocol = await Protocol.deploy(proxy.address);
    await protocol.deployed();
    console.log('Protocol deployed to:', protocol.address);

    // Get data from initial config
    const tx = await protocol.getData();
    const receipt = await tx.wait();
    console.log("Data with initial config = ", receipt.events[0].args.toString());

    const sumTx = await protocol.getLocalData();
    const sumReceipt = await sumTx.wait();

    console.log("Sum= ", sumReceipt);

    expect(sumReceipt).to.equal(3);
  });
});