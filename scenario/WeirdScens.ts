import { scenario } from './CometContext';
import { expect } from 'chai';

async function rando(name: string) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (Date.now() % 5 === 0) {
        reject(new Error("bleh " + name));
      } else {
        resolve(null);
      }
    }, 2000);
  })
}

scenario.skip("scen 4", {}, async (context, world) => {
  await rando("scen 4");
});

scenario.skip("scen 5", {}, async (context, world) => {
  await rando("scen 5");
});

scenario.skip("scen 6", {}, async (context, world) => {
  await rando("scen 6");
});