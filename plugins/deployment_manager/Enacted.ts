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
    trace(`Wrote \`enacted\` to migration at: ${migrationPath}`)
  }

  return newSourceCode;
}

export function addEnactedToMigration(sourceFile: ts.SourceFile): string {
  // XXX The following method directly modifying the AST seems less error-prone,
  // but unfortunately messes with the original formatting of the file
  // const enactedMethodDeclaration = ts.factory.createMethodDeclaration(
  //   [],
  //   [ts.factory.createModifier(ts.SyntaxKind.AsyncKeyword)],
  //   undefined,
  //   'enacted',
  //   undefined,
  //   [],
  //   [
  //     ts.factory.createParameterDeclaration(
  //       [],
  //       [],
  //       undefined,
  //       'deploymentManager',
  //     )
  //   ],
  //   undefined,
  //   ts.factory.createBlock([
  //     ts.factory.createReturnStatement(ts.factory.createTrue())
  //   ])
  // ts.factory.createVariableDeclarationList(
  //   [ts.factory.createVariableDeclaration(
  //     ts.factory.createIdentifier("testVar"),
  //     undefined,
  //     ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
  //     ts.factory.createStringLiteral("test")
  //   )],
  //   ts.NodeFlags.Const
  // );

  // const transformerFactory: ts.TransformerFactory<ts.Node> = (
  //   context: ts.TransformationContext
  // ) => {
  //   return (rootNode) => {
  //     function visit(node: ts.Node): ts.Node {
  //       node = ts.visitEachChild(node, visit, context);
  //       if (ts.isExportAssignment(node)) {
  //         console.log('IS EXPORT ASSIGNMENT')
  //         console.log(node)
  //         const callExpression = node.expression as ts.CallExpression;
  //         const objectLiteralExpression = callExpression.arguments.find(x => x.kind === ts.SyntaxKind.ObjectLiteralExpression) as ts.ObjectLiteralExpression;
  //         console.log(objectLiteralExpression)
  //         console.log('print properties')

  //         const newProperties = objectLiteralExpression.properties.filter(x => (x.name as ts.Identifier).escapedText !== 'enacted');
  //         newProperties.push(enactedMethodDeclaration)
  //         const newObjectLiteralExpression = ts.factory.createObjectLiteralExpression(newProperties, true);
  //         const newCallExpressionArguments = callExpression.arguments.filter(x => x.kind !== ts.SyntaxKind.ObjectLiteralExpression);
  //         newCallExpressionArguments.push(newObjectLiteralExpression);
  //         const newCallExpression = ts.factory.createCallExpression(
  //           callExpression.expression, callExpression.typeArguments,
  //           newCallExpressionArguments
  //         )

  //         return ts.factory.createExportAssignment(
  //           node.decorators, node.modifiers, node.isExportEquals,
  //           newCallExpression
  //         )
  //       }
  //       return node;
  //     }

  //     return ts.visitNode(rootNode, visit);
  //   };
  // };

  // const transformationResult = ts.transform(
  //   sourceFile, [transformerFactory]
  // );
  // const transformedSourceFile = transformationResult.transformed[0];
  // const printer = ts.createPrinter();
  // const result = printer.printNode(
  //   ts.EmitHint.Unspecified,
  //   transformedSourceFile,
  //   undefined
  // );
  // console.log(result)

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
      endPos = enacted.end + 1;
    }
    newSourceCode = sourceFileText.substring(0, enacted.pos)
      + code
      + sourceFileText.substring(endPos);
  } else {
    // XXX doesn't handle trailing comments well yet
    // Can use ts.getTrailingCommentRanges to figure that out and use
    // the last comment end position instead of enact.end
    let insertPos;
    if (sourceFileText.charAt(enact.end) === ',') {
      insertPos = enact.end + 1;
    } else {
      insertPos = enact.end;
      code = ',' + code;
    }
    newSourceCode = sourceFileText.substring(0, insertPos)
      + code
      + sourceFileText.substring(insertPos);
  }

  return newSourceCode;
}