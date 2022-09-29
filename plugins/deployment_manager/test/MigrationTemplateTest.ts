import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { Cache } from '../Cache';
import { generateMigration, migrationTemplate } from '../MigrationTemplate';

import { tempDir } from './TestHelpers';

use(chaiAsPromised);

export const expectedTemplate = `import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';

interface Vars {};

export default migration('1_cool', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (governanceDeploymentManager: DeploymentManager, vars: Vars) => {
    // No governance changes
  }
});
`;

describe('MigrationTemplate', () => {
  it('test a simple template', async () => {
    expect(migrationTemplate({ timestamp: 1, name: 'cool' })).to.equal(expectedTemplate);
  });

  it('should write to cache', async () => {
    let cache = new Cache('test-network', 'test-deployment', true, tempDir());

    expect(await generateMigration(cache, 'cool', 1)).to.equal('1_cool.ts');
    cache.clearMemory();

    expect(await cache.readCache({ rel: ['migrations', '1_cool.ts'] }, (x) => x)).to.equal(
      expectedTemplate
    );
  });

  it('should fail if already exists', async () => {
    let cache = new Cache('test-network', 'test-deployment', true, tempDir());

    expect(await generateMigration(cache, 'cool', 1)).to.equal('1_cool.ts');

    // Try to re-store
    await expect(generateMigration(cache, 'cool', 1)).to.be.rejectedWith('Migration 1_cool.ts already exists.');

    // Clear the cache
    cache.clearMemory();

    // Try to re-store again
    await expect(generateMigration(cache, 'cool', 1)).to.be.rejectedWith('Migration 1_cool.ts already exists.');

    expect(await cache.readCache({ rel: ['migrations', '1_cool.ts'] }, (x) => x)).to.equal(
      expectedTemplate
    );
  });
});
