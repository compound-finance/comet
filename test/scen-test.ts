/* Check basic scenario compilation */

import { Runner } from '../plugins/scenario/Runner'
import { CometContext } from '../scenario/CometContext'

const scenarios = [];
new Runner({
  bases: [
    {
      name: "development"
    },
  ],
}).run(scenarios, (...args) => console.log('Result', args))
  .then(r => { /* console.trace(r) */ })
  .catch(e => { throw(e) });
