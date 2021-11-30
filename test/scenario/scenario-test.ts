import { expect } from 'chai';

import Scenario from './Scenario';

describe('Scenario test framework', function () {
  it('allows you to create a Scenario via factory method', async function () {
    const scenario = await Scenario.with({
      greeter: {
        message: "Hello, whirled"
      }
    });

    expect(await scenario.greeter.greet()).to.equal('Hello, world!');
  });

  it('allows you to simulate time passing', async function () {
    const scenario = await Scenario.with({
      greeter: {
        message: "Hello, whirled"
      }
    });

    await scenario.increaseTime(300); // simulate 5 minutes passing

    expect(await scenario.greeter.greet()).to.equal('Hello, world!');
  });
});
