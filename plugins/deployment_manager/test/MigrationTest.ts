import { expect } from 'chai';
import { Cache } from '../Cache';
import { Loader, Migration, getArtifactSpec, loader, migration, setupLoader } from '../Migration';

describe('Migration', () => {
  it('test a simple migration', async () => {
    setupLoader();
    let x = [];
    migration('test migration', {
      prepare: async (deploymentManager) => {
        x = [...x, 'step 1'];
        return 'step 2';
      },
      enact: async (deploymentManager, y) => {
        x = [...x, y];
      },
    });
    let migrations = (loader as Loader<string>).getMigrations();
    expect(Object.keys(migrations)).to.eql(['test migration']);
    let [m] = Object.values(migrations);
    expect(x).to.eql([]);
    let v: string = await m.actions.prepare(<unknown>null);
    expect(x).to.eql(['step 1']);
    await m.actions.enact(<unknown>null, v);
    expect(x).to.eql(['step 1', 'step 2']);
  });

  it('returns proper artifact file spec', async () => {
    let migration: Migration<null> = {
      name: 'test',
      actions: {},
    };

    expect(getArtifactSpec(migration)).to.eql({ rel: ['artifacts', 'test.json'] });
  });
});
