import { scenario, World } from '../scen2';
import { CometContext } from './Context';

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

scenario("scen 4", {}, async (context: CometContext, world: World) => {
  await rando("scen 4");
});

scenario("scen 5", {}, async (context: CometContext, world: World) => {
  await rando("scen 4");
});

scenario("scen 6", {}, async (context: CometContext, world: World) => {
  await rando("scen 4");
});
