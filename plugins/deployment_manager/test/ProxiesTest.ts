import { expect } from 'chai';
import { Cache } from '../Cache';
import { getProxies, putProxy, storeProxies } from '../Proxies';
import { objectFromMap } from '../Utils';
import { tempDir } from './TestHelpers';

describe('Proxies', () => {
  it('gets and sets proxies', async () => {
    let cache = new Cache('test', true, tempDir());

    expect(objectFromMap(await getProxies(cache))).to.eql({});
    await storeProxies(cache, new Map([['poochie', '0x0000000000000000000000000000000000000000']]));
    expect(objectFromMap(await getProxies(cache))).to.eql({
      poochie: '0x0000000000000000000000000000000000000000',
    });

    cache.clearMemory();

    expect(objectFromMap(await getProxies(cache))).to.eql({
      poochie: '0x0000000000000000000000000000000000000000',
    });

    await putProxy(cache, 'cat', '0x0000000000000000000000000000000000000002');

    expect(objectFromMap(await getProxies(cache))).to.eql({
      poochie: '0x0000000000000000000000000000000000000000',
      cat: '0x0000000000000000000000000000000000000002',
    });
  });
});
