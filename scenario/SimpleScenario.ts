import { scenario } from './Context';
import { expect } from 'chai';

scenario.only("my scenario", {}, async (ctx, world) => {
  expect(await ctx.players()).to.eql([]);
  console.log("Roof said " + ctx.dog);
});

scenario("scen 2", {}, async (context, world) => {
  expect(context.dog).to.equal("jack");
});

scenario("scen 3", {}, async (context, world) => {
  expect(context.dog).to.equal("spot");
});
