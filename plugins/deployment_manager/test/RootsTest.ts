import { expect } from 'chai';
import { Cache } from '../Cache';
import { getRoots, putRoots } from '../Roots';
import { objectFromMap } from '../Utils';
import { tempDir } from './TestHelpers';

describe('Roots', () => {
  it('gets and sets roots', async () => {
    let cache = new Cache('test-network', 'test-deployment', true, tempDir());

    expect(objectFromMap(await getRoots(cache))).to.eql({});
    await putRoots(cache, new Map([['poochie', '0x0000000000000000000000000000000000000000']]));
    expect(objectFromMap(await getRoots(cache))).to.eql({
      poochie: '0x0000000000000000000000000000000000000000'
    });

    cache.clearMemory();

    expect(objectFromMap(await getRoots(cache))).to.eql({
      poochie: '0x0000000000000000000000000000000000000000'
    });
  });
});
