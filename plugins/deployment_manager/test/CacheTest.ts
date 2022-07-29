import { expect } from 'chai';
import { tempDir } from './TestHelpers';

import { Cache } from '../Cache';
import { objectFromMap } from '../Utils';

describe('Cache', () => {
  it('read and store values in-memory', async () => {
    let cache = new Cache('test-network', 'test-deployment', false, tempDir());

    await cache.storeCache(['abc'], 5);

    expect(cache.cache).to.eql(new Map([['abc', 5]]));

    expect(await cache.readCache('abc')).to.eql(5);
  });

  it('read and store values in-memory rel', async () => {
    let cache = new Cache('test-network', 'test-deployment', false, tempDir());

    await cache.storeCache({ rel: 'abc' }, 5);

    expect(cache.cache).to.eql(new Map([['test-network', new Map([['test-deployment', new Map([['abc', 5]])]])]]));

    expect(await cache.readCache({ rel: 'abc' })).to.eql(5);
  });

  it('read and store values to disk', async () => {
    let cache = new Cache('test-network', 'test-deployment', true, tempDir());

    await cache.storeCache(['abc'], 5);

    expect(cache.cache).to.eql(new Map([['abc', 5]]));

    expect(await cache.readCache('abc')).to.eql(5);

    cache.cache = new Map(); // Kill in-memory key

    expect(await cache.readCache('abc')).to.eql(5);
  });

  it('read and store values to disk rel', async () => {
    let cache = new Cache('test-network', 'test-deployment', true, tempDir());

    await cache.storeCache({ rel: 'abc' }, 5);

    expect(cache.cache).to.eql(new Map([['test-network', new Map([['test-deployment', new Map([['abc', 5]])]])]]));

    expect(await cache.readCache({ rel: 'abc' })).to.eql(5);

    cache.cache = new Map(); // Kill in-memory key

    expect(await cache.readCache({ rel: 'abc' })).to.eql(5);
  });

  describe('map', () => {
    it('read and store values in-memory rel', async () => {
      let cache = new Cache('test-network', 'test-deployment', false, tempDir());

      await cache.storeMap({ rel: 'abc' }, new Map([['a', 5]]));

      expect(cache.cache).to.eql(new Map([['test-network', new Map([['test-deployment', new Map([['abc', new Map([['a', 5]])]])]])]]));

      expect(objectFromMap(await cache.readCache({ rel: 'abc' }))).to.eql({a: 5});

      await cache.storeMap({ rel: 'abc' }, new Map([['a', 6]]));

      expect(objectFromMap(await cache.readCache({ rel: 'abc' }))).to.eql({a: 6});
    });
  });

  describe('getFilePath', async () => {
    it('returns proper rel path', async () => {
      let dir = tempDir();
      let cache = new Cache('test-network', 'test-deployment', true, dir);

      expect(cache.getFilePath({ rel: 'abc.cool' })).to.equal(`${dir}/test-network/test-deployment/abc.cool`);
    });
  });
});
