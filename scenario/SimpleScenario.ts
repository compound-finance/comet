import { scenario } from './Context';
import { expect } from 'chai';

scenario.only("my scenario", {}, async (ctx, world) => {
  expect(await ctx.btcBalance("0xbf72da2bd84c5170618fbe5914b0eca9638d5eb5")).to.equal(52324.33000111);
  console.log("Roof said " + ctx.dog);
});

scenario("scen 2", {}, async (context, world) => {
  expect(context.dog).to.equal("jack");
});

scenario("scen 3", {}, async (context, world) => {
  expect(context.dog).to.equal("spot");
});
