import { expect } from 'chai';
import { tempDir } from './TestHelpers';

import { Cache } from '../Cache';

describe('Cache', () => {
  it('read and store values in-memory', async () => {
    let cache = new Cache('test', false, tempDir());

    await cache.storeCache(['abc'], 5);

    expect(cache.cache).to.eql({
      abc: 5,
    });

    expect(await cache.readCache('abc')).to.eql(5);
  });

  it('read and store values in-memory rel', async () => {
    let cache = new Cache('test', false, tempDir());

    await cache.storeCache({ rel: 'abc' }, 5);

    expect(cache.cache).to.eql({
      test: {
        abc: 5,
      },
    });

    expect(await cache.readCache({ rel: 'abc' })).to.eql(5);
  });

  it('read and store values to disk', async () => {
    let cache = new Cache('test', true, tempDir());

    await cache.storeCache(['abc'], 5);

    expect(cache.cache).to.eql({
      abc: 5,
    });

    expect(await cache.readCache('abc')).to.eql(5);

    cache.cache = {}; // Kill in-memory key

    expect(await cache.readCache('abc')).to.eql(5);
  });

  it('read and store values to disk rel', async () => {
    let cache = new Cache('test', true, tempDir());

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

  describe('getFilePath', async () => {
    it('returns proper rel path', async () => {
      let dir = tempDir();
      let cache = new Cache('test', true, dir);

      expect(cache.getFilePath({ rel: 'abc.cool' })).to.equal(`${dir}/test/abc.cool`);
    });
  });
});
