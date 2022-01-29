import { expect } from 'chai';
import * as os from 'os';

import { Cache } from '../Cache';

describe('Cache', () => {
  it('read and store values in-memory', async () => {
    let cache = new Cache('test', false, os.tmpdir());

    await cache.storeCache(['abc'], 5);

    expect(cache.cache).to.eql({
      abc: 5,
    });

    expect(await cache.readCache('abc')).to.eql(5);
  });

  it('read and store values in-memory rel', async () => {
    let cache = new Cache('test', false, os.tmpdir());

    await cache.storeCache({ rel: 'abc' }, 5);

    expect(cache.cache).to.eql({
      test: {
        abc: 5,
      },
    });

    expect(await cache.readCache({ rel: 'abc' })).to.eql(5);
  });

  it('read and store values to disk', async () => {
    let cache = new Cache('test', true, os.tmpdir());

    await cache.storeCache(['abc'], 5);

    expect(cache.cache).to.eql({
      abc: 5,
    });

    expect(await cache.readCache('abc')).to.eql(5);

    cache.cache = {}; // Kill in-memory key

    expect(await cache.readCache('abc')).to.eql(5);
  });

  it('read and store values to disk rel', async () => {
    let cache = new Cache('test', true, os.tmpdir());

    await cache.storeCache({ rel: 'abc' }, 5);

    expect(cache.cache).to.eql({
      test: {
        abc: 5,
      },
    });

    expect(await cache.readCache({ rel: 'abc' })).to.eql(5);

    cache.cache = {}; // Kill in-memory key

    expect(await cache.readCache({ rel: 'abc' })).to.eql(5);
  });
});
