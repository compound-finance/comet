import { Cache } from './Cache';

export interface MigrationTemplateVars {
  timestamp: number;
  name: string;
}

export function migrationTemplate({ timestamp, name }: MigrationTemplateVars): string {
  return `import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';

interface Vars {};

export default migration('${timestamp}_${name}', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, vars: Vars) => {
    // No governance changes
  }
});\n`;
}

export function migrationName({ timestamp, name }: MigrationTemplateVars): string {
  return `${timestamp}_${name}.ts`;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

export async function generateMigration(
  cache: Cache,
  name: string,
  timestamp?: number
): Promise<string> {
  let templateVars: MigrationTemplateVars = { name, timestamp: timestamp ?? now() };
  let migrationFileName = migrationName(templateVars);
  let migrationFileSpec = { rel: ['migrations', migrationFileName] };

  if (await cache.readCache(migrationFileSpec, (x) => x) !== undefined) {
    throw new Error(`Migration ${migrationFileName} already exists.`);
  }

  await cache.storeCache(
    migrationFileSpec,
    migrationTemplate(templateVars),
    (x) => x.toString()
  );

  return migrationFileName;
}
