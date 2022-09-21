import { DeploymentManager } from './DeploymentManager';
import * as ts from 'typescript';
import * as fs from 'fs/promises';
import { Migration } from './Migration';

export async function writeEnacted<T>(migration: Migration<T>, deploymentManager: DeploymentManager, writeToFile: boolean = true): Promise<string> {
  const network = deploymentManager.network;
  const deployment = deploymentManager.deployment;
  const migrationPath = `./deployments/${network}/${deployment}/migrations/${migration.name}.ts`;
  const program = ts.createProgram([migrationPath], { allowJs: true });
  const sourceFile = program.getSourceFile(migrationPath);
  const newSourceCode = addEnactedToMigration(sourceFile);

  if (writeToFile) {
    const trace = deploymentManager.tracer();
    await fs.writeFile(migrationPath, newSourceCode);
    trace(`Wrote \`enacted\` to migration at: ${migrationPath}`);
  }

  return newSourceCode;
}

export function addEnactedToMigration(sourceFile: ts.SourceFile): string {
  // Note: Another approach is to directly modify the AST, but unfortunately this does not
  // preserve the original formatting of the source code
  // Example of the AST approach in commit 73e60480627230d84bb40ab0269722a3e839713a
  const sourceFileText = sourceFile.getFullText();
  const exportAssignment = sourceFile.statements.find(ts.isExportAssignment)!;
  const callExpression = exportAssignment.expression as ts.CallExpression;
  const objectLiteralExpression = callExpression.arguments.find(x => x.kind === ts.SyntaxKind.ObjectLiteralExpression) as ts.ObjectLiteralExpression;
  const enact = objectLiteralExpression.properties.find(x => (x.name as ts.Identifier).escapedText == 'enact')!;
  const enacted = objectLiteralExpression.properties.find(x => (x.name as ts.Identifier).escapedText == 'enacted');
  let code =
    `\n\n  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {\n    return true;\n  },`;
  let newSourceCode;
  if (enacted) {
    // If enacted already exists, just replace it
    let endPos = enacted.end;
    if (sourceFileText.charAt(enacted.end) === ',') {
      // Skip the original comma to avoid double commas
      endPos = enacted.end + 1;
    }
    newSourceCode = sourceFileText.substring(0, enacted.pos)
      + code
      + sourceFileText.substring(endPos);
  } else {
    let insertPos;
    if (sourceFileText.charAt(enact.end) === ',') {
      // Insert after the comma
      insertPos = enact.end + 1;
    } else {
      // Prepend a comma
      insertPos = enact.end;
      code = ',' + code;
    }
    newSourceCode = sourceFileText.substring(0, insertPos)
      + code
      + sourceFileText.substring(insertPos);
  }

  return newSourceCode;
}