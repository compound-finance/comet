const { readFile, writeFile } = require('fs/promises');
const stream = require('stream');
const { spawn } = require('child_process');

async function pandoc(doc) {
  let resolve, reject;
  let res = new Promise((resolve_, reject_) => {
    resolve = resolve_;
    reject = reject_;
  });

  child = spawn('pandoc', ['-f', 'markdown', '-o', 'SPEC.pdf']);
  child.on('close', (code) => {
    if (code === 0) {
      resolve();
    } else {
      reject(new Error(`exit code: ${code}`));
    }
  });
  child.stdout.on('data', (data) => {
    console.log('pandoc: ' + data);
  });
  var stdinStream = new stream.Readable();
  stdinStream.push(doc);
  stdinStream.push(null);
  stdinStream.pipe(child.stdin);

  return res;
}

async function run() {
  let file = await readFile('SPEC.md', 'utf8');
  let innerRegex = /% preamble((.|\n)+?)(?=% postamble)/gim;
  let templateRegex = /% header %/;
  let postambleRegex = /\$\$\s*\n\s*% postamble\s*\n\s*\$\$/;

  let inner = innerRegex.exec(file);
  let template = templateRegex.exec(file);
  let preamble = inner[0];

  preamble = preamble.replace(
    /(?<=[\]\}]\{\\(Config|Storage|ContractCall).*)(([a-z]+)|((?<!#)[0-9]+))/g,
    '\\text{$2}'
  );

  let doc = file
    .replace(innerRegex, '')
    .replace(templateRegex, preamble)
    .replace(postambleRegex, '');

  // await writeFile("SPEC_DOC.md", doc);

  await pandoc(doc);
}

run();
