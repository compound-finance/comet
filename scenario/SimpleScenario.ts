import { scenario, World } from '../plugins/scenario';
import { CometContext } from './Context';
import { expect } from 'chai';

scenario("my scenario", {}, async (context: CometContext, world: World) => {
  console.log("Roof said " + context.dog);
});

scenario("scen 2", {}, async (context: CometContext, world: World) => {
  expect(context.dog).to.equal("jack");
});

scenario("scen 3", {}, async (context: CometContext, world: World) => {
  expect(context.dog).to.equal("spot");
});
