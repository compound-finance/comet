import { scenario } from './Context';
import { expect } from 'chai';

scenario("my scenario", {}, async (context, world) => {
  console.log("Roof said " + context.dog);
});

scenario("scen 2", {}, async (context, world) => {
  expect(context.dog).to.equal("jack");
});

scenario("scen 3", {}, async (context, world) => {
  expect(context.dog).to.equal("spot");
});
