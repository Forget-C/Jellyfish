import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const cli = path.resolve(import.meta.dirname, 'repository-hooks.mjs');
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', PATH: `${path.dirname(process.execPath)}:${process.env.PATH}` };
function git(dir, ...args) {
  return spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Hook Test', '-c', 'user.email=hook-test@example.invalid', ...args], { cwd: dir, encoding: 'utf8', env });
}
function gitOk(dir, ...args) {
  const result = git(dir, ...args);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result.stdout.trim();
}
function fixture(t) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'jellyfish-hooks-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = path.join(base, 'repo with spaces');
  mkdirSync(dir);
  gitOk(dir, 'init', '-b', 'main');
  // Isolate fixture commits from any user hook configuration.
  gitOk(dir, 'config', 'core.hooksPath', '/dev/null');
  cpSync(path.resolve(import.meta.dirname, '../.githooks'), path.join(dir, '.githooks'), { recursive: true });
  mkdirSync(path.join(dir, 'scripts'));
  cpSync(path.resolve(import.meta.dirname, 'check-commit-subject.mjs'), path.join(dir, 'scripts/check-commit-subject.mjs'));
  gitOk(dir, 'add', '.');
  gitOk(dir, 'commit', '-m', '[chore] fixture');
  gitOk(dir, 'config', '--unset', 'core.hooksPath');
  return { dir, base };
}
function run(cwd, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env });
}

test('check is read-only and reports unconfigured hooks with a repair command', (t) => {
  const { dir } = fixture(t);
  const config = readFileSync(path.join(dir, '.git/config'), 'utf8');
  const result = run(dir, 'check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not enabled/);
  assert.match(result.stderr, /repository-hooks.mjs install/);
  assert.equal(readFileSync(path.join(dir, '.git/config'), 'utf8'), config);
});

test('explicit installation is repeatable, repository-scoped and enforces actual commits and merges', (t) => {
  const { dir, base } = fixture(t);
  gitOk(dir, 'config', 'user.name', 'Preserved Identity');
  gitOk(dir, 'config', 'commit.gpgsign', 'true');
  let result = run(base, 'install', '--repo', dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(gitOk(dir, 'config', '--local', '--get', 'core.hooksPath'), '.githooks');
  const config = readFileSync(path.join(dir, '.git/config'), 'utf8');
  assert.equal(run(dir, 'install').status, 0);
  assert.equal(readFileSync(path.join(dir, '.git/config'), 'utf8'), config);
  assert.equal(gitOk(dir, 'config', '--local', '--get', 'user.name'), 'Preserved Identity');
  assert.equal(gitOk(dir, 'config', '--local', '--get', 'commit.gpgsign'), 'true');
  mkdirSync(path.join(dir, 'nested'));
  result = run(path.join(dir, 'nested'), 'check');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /gitDir=.*commonGitDir=/s);
  assert.equal(run(base, 'check', '--repo', dir).status, 0);
  assert.notEqual(git(dir, 'commit', '--allow-empty', '-m', 'invalid').status, 0);
  gitOk(dir, 'commit', '--allow-empty', '-m', '[fix] valid');
  gitOk(dir, 'checkout', '-b', 'topic');
  gitOk(dir, 'commit', '--allow-empty', '-m', '[feat] topic');
  gitOk(dir, 'checkout', 'main');
  assert.notEqual(git(dir, 'merge', '--no-ff', '--no-edit', 'topic').status, 0);
  gitOk(dir, 'commit', '-m', '[chore] merge topic');
});

test('custom hook paths are preserved unless replacement is explicitly requested', (t) => {
  const { dir } = fixture(t);
  gitOk(dir, 'config', '--local', 'core.hooksPath', '../custom hooks');
  const config = readFileSync(path.join(dir, '.git/config'), 'utf8');
  for (const mode of ['check', 'install']) {
    const result = run(dir, mode);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /custom hooks/);
    assert.match(result.stderr, /--replace-custom-hooks-path/);
    assert.equal(readFileSync(path.join(dir, '.git/config'), 'utf8'), config);
  }
  const result = run(dir, 'install', '--replace-custom-hooks-path');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(run(dir, 'check').status, 0);
  assert.equal(gitOk(dir, 'config', '--local', '--get', 'core.hooksPath'), '.githooks');
});

test('missing and non-executable hooks or missing checker fail without changing configuration', (t) => {
  for (const [name, damage, reason] of [
    ['.githooks/commit-msg', 'remove', /commit-msg.*missing/],
    ['.githooks/prepare-commit-msg', 'remove', /prepare-commit-msg.*missing/],
    ['.githooks/commit-msg', 'permission', /commit-msg.*executable/],
    ['.githooks/prepare-commit-msg', 'permission', /prepare-commit-msg.*executable/],
    ['scripts/check-commit-subject.mjs', 'remove', /check-commit-subject.mjs.*missing/],
  ]) {
    const { dir } = fixture(t);
    assert.equal(run(dir, 'install').status, 0);
    const file = path.join(dir, name);
    if (damage === 'remove') rmSync(file);
    else chmodSync(file, 0o644);
    const config = readFileSync(path.join(dir, '.git/config'), 'utf8');
    for (const mode of ['check', 'install']) {
      const result = run(dir, mode);
      assert.equal(result.status, 1, `${name} ${mode}`);
      assert.match(result.stderr, reason);
      assert.match(result.stderr, /Repair/);
      assert.equal(readFileSync(path.join(dir, '.git/config'), 'utf8'), config);
    }
  }
});

test('shared installation from a linked worktree works in each checkout and across cwd', (t) => {
  const { dir, base } = fixture(t);
  const linked = path.join(base, 'linked checkout');
  gitOk(dir, 'worktree', 'add', '-b', 'linked', linked);
  const result = run(base, 'install', '--repo', linked);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(path.join(dir, '.git/worktrees')));
  assert.ok(result.stdout.includes(`commonGitDir=${path.join(dir, '.git')}`));
  for (const checkout of [dir, linked]) {
    assert.equal(run(base, 'check', '--repo', checkout).status, 0);
    assert.equal(run(checkout, 'install').status, 0);
    assert.notEqual(git(checkout, 'commit', '--allow-empty', '-m', 'invalid').status, 0);
    gitOk(checkout, 'commit', '--allow-empty', '-m', '[fix] valid in checkout');
  }
});

test('per-worktree custom overrides are preserved and require explicit replacement', (t) => {
  const { dir, base } = fixture(t);
  const linked = path.join(base, 'linked');
  gitOk(dir, 'worktree', 'add', '-b', 'linked', linked);
  gitOk(dir, 'config', 'extensions.worktreeConfig', 'true');
  gitOk(linked, 'config', '--worktree', 'core.hooksPath', '../custom linked hooks');
  const config = readFileSync(path.join(dir, '.git/config'), 'utf8');
  const overridePath = gitOk(linked, 'rev-parse', '--git-path', 'config.worktree');
  const override = readFileSync(overridePath, 'utf8');
  const refused = run(dir, 'install');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /custom linked hooks/);
  assert.equal(readFileSync(path.join(dir, '.git/config'), 'utf8'), config);
  assert.equal(readFileSync(overridePath, 'utf8'), override);
  const result = run(dir, 'install', '--replace-custom-hooks-path');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(run(linked, 'check').status, 0);
  assert.notEqual(git(linked, 'commit', '--allow-empty', '-m', 'invalid').status, 0);
  gitOk(linked, 'commit', '--allow-empty', '-m', '[fix] valid linked commit');
});

test('global custom configuration is protected and explicit replacement only writes repository config', (t) => {
  const { dir, base } = fixture(t);
  const globalFile = path.join(base, 'isolated-global-config');
  const original = '[core]\n\thooksPath = /custom/global-hooks\n[user]\n\tname = Untouched Global User\n[commit]\n\tgpgsign = true\n';
  writeFileSync(globalFile, original);
  function withGlobal(...args) {
    return spawnSync(process.execPath, [cli, ...args], {
      cwd: dir, encoding: 'utf8', env: { ...env, GIT_CONFIG_GLOBAL: globalFile },
    });
  }
  const refused = withGlobal('install');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /global-hooks/);
  assert.equal(git(dir, 'config', '--local', '--get', 'core.hooksPath').status, 1);
  const installed = withGlobal('install', '--replace-custom-hooks-path');
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(withGlobal('check').status, 0);
  assert.equal(readFileSync(globalFile, 'utf8'), original);
});

test('installation checks linked checkout prerequisites before changing shared configuration', (t) => {
  const { dir, base } = fixture(t);
  const linked = path.join(base, 'linked');
  gitOk(dir, 'worktree', 'add', '-b', 'linked', linked);
  rmSync(path.join(linked, '.githooks/prepare-commit-msg'));
  const config = readFileSync(path.join(dir, '.git/config'), 'utf8');
  const result = run(dir, 'install');
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(linked));
  assert.match(result.stderr, /prepare-commit-msg.*missing/);
  assert.equal(readFileSync(path.join(dir, '.git/config'), 'utf8'), config);
});

test('non-repository and invalid CLI calls fail without creating repository files', (t) => {
  const { base } = fixture(t);
  for (const args of [['check'], ['install'], ['install', '--repo', path.join(base, 'absent')], [], ['unknown'], ['check', '--replace-custom-hooks-path'], ['install', '--repo'], ['install', '--unknown']]) {
    const result = run(base, ...args);
    assert.equal(result.status, 1, args.join(' '));
    assert.doesNotMatch(result.stdout, /enabled/);
  }
});
