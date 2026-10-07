// Python ML service helper.
//   npm run ml:install  → create ml_service/.venv and install requirements.txt
//   npm run ml:health   → run predict.py --health with the venv Python
// Set PYTHON to choose which Python creates the venv (e.g. PYTHON="py -3.12" on Windows).

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serviceDir = path.join(root, 'ml_service')
const venvDir = path.join(serviceDir, '.venv')
const isWindows = process.platform === 'win32'
const venvPython = isWindows ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python')
const MIN_VERSION = [3, 10]

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}`)
}

function pythonVersion(command, args) {
  const result = spawnSync(command, [...args, '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' })
  if (result.status !== 0 || !result.stdout) return null
  const [major, minor] = result.stdout.trim().split('.').map(Number)
  return { major, minor }
}

function findBasePython() {
  const candidates = process.env.PYTHON
    ? [process.env.PYTHON.split(' ')]
    : isWindows
      ? [['py', '-3.12'], ['py', '-3.11'], ['py', '-3'], ['python']]
      : [['python3.12'], ['python3.11'], ['python3'], ['python']]
  for (const [command, ...args] of candidates) {
    const version = pythonVersion(command, args)
    if (!version) continue
    if (version.major > MIN_VERSION[0] || (version.major === MIN_VERSION[0] && version.minor >= MIN_VERSION[1])) {
      return { command, args, version }
    }
    console.warn(`[ml] Skipping ${command} ${args.join(' ')} (Python ${version.major}.${version.minor} is too old)`)
  }
  return null
}

function health() {
  const python = process.env.ML_PYTHON || (existsSync(venvPython) ? venvPython : isWindows ? 'python' : 'python3')
  const result = spawnSync(python, [path.join(serviceDir, 'predict.py'), '--health'], { encoding: 'utf8', cwd: serviceDir })
  if (result.error) {
    console.error(`[ml] Could not run ${python}: ${result.error.message}. Run "npm run ml:install" first.`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(result.stderr)
    process.exit(1)
  }
  const report = JSON.parse(result.stdout)
  console.log(`[ml] Python ${report.python} (${python})`)
  for (const [name, version] of Object.entries(report.packages)) console.log(`  ${version ? '✓' : '✗'} ${name}${version ? ` ${version}` : ' — missing'}`)
  console.log(report.status === 'ok' ? '[ml] ML service ready.' : '[ml] Some packages are missing. Run "npm run ml:install".')
  process.exit(report.status === 'ok' ? 0 : 1)
}

function install() {
  if (!existsSync(venvPython)) {
    const base = findBasePython()
    if (!base) {
      console.error('[ml] Python 3.10+ not found. Install Python 3.12 from python.org (tick "Add to PATH"), then run this again.')
      process.exit(1)
    }
    console.log(`[ml] Creating virtual environment with Python ${base.version.major}.${base.version.minor}…`)
    run(base.command, [...base.args, '-m', 'venv', venvDir])
  }
  console.log('[ml] Installing packages from ml_service/requirements.txt (this can take a few minutes)…')
  run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'])
  run(venvPython, ['-m', 'pip', 'install', '-r', path.join(serviceDir, 'requirements.txt')])
  health()
}

const command = process.argv[2]
if (command === 'install') install()
else if (command === 'health') health()
else {
  console.error('Usage: node scripts/ml.mjs <install|health>')
  process.exit(1)
}
