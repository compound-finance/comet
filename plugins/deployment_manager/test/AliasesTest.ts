import { expect } from 'chai';
import { Cache } from '../Cache';
import { getAliases, getInvertedAliases, putAlias } from '../Aliases';
import { objectFromMap } from '../Utils';
import * as os from 'os';

describe('Aliases', () => {
  it('gets and sets aliases', async () => {
    let cache = new Cache('test-network', 'test-deployment', false, os.tmpdir());

    expect(objectFromMap(await getAliases(cache))).to.eql({});
    await putAlias(cache, 'poochie', '0x0000000000000000000000000000000000000000');
    expect(objectFromMap(await getAliases(cache))).to.eql({
      poochie: '0x0000000000000000000000000000000000000000',
    });
    await putAlias(cache, 'poochie', '0x0000000000000000000000000000000000000001');
    await putAlias(cache, 'itchy', '0x0000000000000000000000000000000000000001');
    expect(objectFromMap(await getAliases(cache))).to.eql({
      poochie: '0x0000000000000000000000000000000000000001',
      itchy: '0x0000000000000000000000000000000000000001',
    });
    expect(objectFromMap(await getInvertedAliases(cache))).to.eql({
      '0x0000000000000000000000000000000000000001': ['poochie', 'itchy'],
    });
  });
});
