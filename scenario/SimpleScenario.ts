import { scenario } from './Context';
import { expect } from 'chai';

scenario.only("my scenario", {}, async ({players}, world) => {
  expect(await players()).to.eql(["0x29e31E1eE143a76039F00860d3Bd25804357f0b2"]);
});

scenario("scen 2", {}, async (context, world) => {
  expect(context.dog).to.equal("jack");
});

scenario("scen 3", {}, async (context, world) => {
  expect(context.dog).to.equal("spot");
});
