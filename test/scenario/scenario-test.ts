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
});
