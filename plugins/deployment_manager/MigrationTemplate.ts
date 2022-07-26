import { Cache } from './Cache';

export interface MigrationTemplateVars {
  timestamp: number;
  name: string;
}

export function migrationTemplate({ timestamp, name }: MigrationTemplateVars): string {
  return `import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';

migration('${timestamp}_${name}', {
  run: async (deploymentManager: DeploymentManager) => {
    // Do stuff here (e.g. deploy, propose, ...)
    // If adding a new contract root, should be a 'deploy' script
    // Otherwise, should be a 'change' script
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
