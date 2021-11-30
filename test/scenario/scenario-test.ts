import { expect } from 'chai';

import Scenario from './Scenario';

describe('Scenario test framework', function () {
  it('allows you to create a Scenario via factory method', async function () {
    const scenario = await Scenario.with({
      greeter: {
        message: "Hello, world"
      }
    });

    expect(await scenario.greeter.greet()).to.equal('Hello, world!');
  });

  it('allows you to simulate time passing', async function () {
    const scenario = await Scenario.with({
      greeter: {
        message: "Hello, world"
      }
    });

    await scenario.increaseTime(300); // simulate 5 minutes passing

    expect(await scenario.greeter.greet()).to.equal('Hello, world!');
  });

  it('allows you to simulate blocks being mined', async function () {
    const scenario = await Scenario.with({
      greeter: {
        message: "Hello, world"
      }
    });

    await scenario.mineBlock(); // simulate block being mined

    expect(await scenario.greeter.greet()).to.equal('Hello, world!');
  });

  it('allows you to take actions as the contract\'s owner', async function () {
    const scenario = await Scenario.with({
      greeter: {
        message: "Hello, world"
      }
    });

    await scenario.greeter.connect(scenario.owner).setGreeting("Owner message");

    expect(await scenario.greeter.greet()).to.equal('Owner message');
  });
});