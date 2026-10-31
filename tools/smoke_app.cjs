const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
try {
  const output = execFileSync(path.join(root, 'runtime/electron-v44.7.2/electron.exe'),
    [path.join(root, 'reconstruction/app'), '--smoke'], { env, cwd: root, encoding: 'utf8', timeout: 35000 });
  process.stdout.write(output);
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  console.error(error.message);
  process.exitCode = 1;
}
