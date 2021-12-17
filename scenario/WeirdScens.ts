import { scenario } from './Context';
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

scenario("scen 4", {}, async (context, world) => {
  await rando("scen 4");
});

scenario("scen 5", {}, async (context, world) => {
  await rando("scen 4");
});

scenario("scen 6", {}, async (context, world) => {
  await rando("scen 4");
});
