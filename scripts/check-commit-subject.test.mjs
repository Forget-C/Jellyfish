import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const cli = path.resolve(import.meta.dirname, 'check-commit-subject.mjs');
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jellyfish-commit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

test('message file accepts every documented type and Chinese summaries, ignoring the body', (t) => {
  const dir = fixture(t);
  for (const type of ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'ci', 'build', 'revert']) {
    const file = path.join(dir, 'message');
    writeFileSync(file, `[${type}] 修复中文内容\n\nbody is unrestricted\n`);
    const result = run(['--message-file', file], dir);
    assert.equal(result.status, 0, result.stderr);
  }
});

test('message file rejects empty titles, invalid types, separators, summaries and default Git titles', (t) => {
  const dir = fixture(t);
  for (const [subject, reason] of [
    ['', '标题不能为空'], ['\n[fix] later line', '标题不能为空'],
    ['[wip] invalid', '类型'], ['[Fix] invalid', '类型'],
    ['[fix]missing space', '空格'], ['[fix]\tsummary', '空格'],
    ['[fix] ', '摘要不能为空'], ['[fix] \t ', '摘要不能为空'],
    ["Merge branch 'topic'", '类型'], ['Revert "change"', '类型'],
  ]) {
    const file = path.join(dir, 'message');
    writeFileSync(file, subject);
    const result = run(['--message-file', file], dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(reason));
  }
  assert.equal(run(['--message-file', path.join(dir, 'absent')], dir).status, 1);
  assert.equal(run([], dir).status, 1);
});

function git(dir, ...args) {
  return spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Commit Test', '-c', 'user.email=commit-test@example.invalid', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}` } });
}
function gitOk(dir, ...args) {
  const result = git(dir, ...args);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result.stdout.trim();
}
function repository(t) {
  const dir = fixture(t);
  gitOk(dir, 'init', '-b', 'main');
  gitOk(dir, 'config', 'core.hooksPath', '/dev/null');
  gitOk(dir, 'commit', '--allow-empty', '-m', '[chore] initial');
  return dir;
}

test('range checks all commits, identifies failures, distinguishes empty and invalid ranges', (t) => {
  const dir = repository(t);
  const base = gitOk(dir, 'rev-parse', 'HEAD');
  gitOk(dir, 'commit', '--allow-empty', '-m', '[fix] 合法标题');
  let result = run(['--range', `${base}..HEAD`], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Checked 1 commit/);
  gitOk(dir, 'commit', '--allow-empty', '-m', 'Revert "invalid"');
  const bad = gitOk(dir, 'rev-parse', 'HEAD');
  gitOk(dir, 'commit', '--allow-empty', '-m', '[wip] another invalid');
  const anotherBad = gitOk(dir, 'rev-parse', 'HEAD');
  result = run(['--range', `${base}..HEAD`], dir);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(anotherBad));
  assert.ok(result.stderr.includes(bad));
  assert.match(result.stderr, /Revert.*invalid.*类型/);
  result = run(['--range', 'HEAD..HEAD'], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No commits to check/);
  for (const range of ['absent..HEAD', 'HEAD..absent', 'HEAD...', 'HEAD', '--all', 'HEAD..HEAD..HEAD']) {
    result = run(['--range', range], dir);
    assert.equal(result.status, 1, range);
    assert.doesNotMatch(result.stdout, /No commits|Checked/);
  }
});

function installFixtureHook(dir) {
  mkdirSync(path.join(dir, '.githooks'));
  mkdirSync(path.join(dir, 'scripts'));
  cpSync(path.resolve(import.meta.dirname, '../.githooks/commit-msg'), path.join(dir, '.githooks/commit-msg'));
  cpSync(path.resolve(import.meta.dirname, '../.githooks/prepare-commit-msg'), path.join(dir, '.githooks/prepare-commit-msg'));
  cpSync(cli, path.join(dir, 'scripts/check-commit-subject.mjs'));
  gitOk(dir, 'config', 'core.hooksPath', '.githooks');
}

test('real Git hook and CI CLI agree on ordinary commits, default merges and reverts', (t) => {
  const dir = repository(t);
  installFixtureHook(dir);
  const base = gitOk(dir, 'rev-parse', 'HEAD');
  assert.equal(git(dir, 'commit', '--allow-empty', '-m', 'invalid').status, 1);
  gitOk(dir, 'commit', '--allow-empty', '-m', '[fix] normal');
  gitOk(dir, 'checkout', '-b', 'topic');
  gitOk(dir, 'commit', '--allow-empty', '-m', '[feat] topic');
  gitOk(dir, 'checkout', 'main');
  assert.equal(git(dir, 'merge', '--no-ff', '--no-edit', 'topic').status, 1);
  gitOk(dir, 'commit', '-m', '[chore] merge topic');
  assert.equal(run(['--range', `${base}..HEAD`], dir).status, 0);
  // Create an actual change so git revert reaches commit-msg rather than an empty revert.
  writeFileSync(path.join(dir, 'change'), 'change');
  gitOk(dir, 'add', 'change');
  gitOk(dir, 'commit', '-m', '[feat] change');
  const reverted = git(dir, 'revert', '--no-edit', 'HEAD');
  assert.notEqual(reverted.status, 0, reverted.stderr);
  gitOk(dir, 'commit', '-m', '[revert] change');
  assert.equal(run(['--range', `${base}..HEAD`], dir).status, 0);
  // CI must also catch a bypassed default merge (a multi-parent commit).
  gitOk(dir, 'checkout', '-b', 'bypassed');
  gitOk(dir, 'commit', '--allow-empty', '-m', '[feat] bypassed topic');
  gitOk(dir, 'checkout', 'main');
  gitOk(dir, '-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff', '--no-edit', 'bypassed');
  const sha = gitOk(dir, 'rev-parse', 'HEAD');
  const result = run(['--range', `${base}..HEAD`], dir);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(sha));
  assert.match(result.stderr, /Merge.*类型/);
});

test('conflict resolution still checks the first line while MERGE_HEAD exists', (t) => {
  const dir = repository(t);
  writeFileSync(path.join(dir, 'conflict'), 'original\n');
  gitOk(dir, 'add', 'conflict');
  gitOk(dir, 'commit', '-m', '[chore] original');
  const base = gitOk(dir, 'rev-parse', 'HEAD');
  installFixtureHook(dir);
  gitOk(dir, 'checkout', '-b', 'topic');
  writeFileSync(path.join(dir, 'conflict'), 'topic\n');
  gitOk(dir, 'add', 'conflict');
  gitOk(dir, 'commit', '-m', '[feat] topic');
  gitOk(dir, 'checkout', 'main');
  writeFileSync(path.join(dir, 'conflict'), 'main\n');
  gitOk(dir, 'add', 'conflict');
  gitOk(dir, 'commit', '-m', '[fix] main');
  assert.notEqual(git(dir, 'merge', 'topic').status, 0);
  writeFileSync(path.join(dir, 'conflict'), 'resolved\n');
  gitOk(dir, 'add', 'conflict');
  assert.notEqual(git(dir, 'commit', '-m', 'Merge resolved conflict').status, 0);
  // Check the actual merge-state message through the same public CLI as CI.
  const file = path.join(dir, 'message');
  writeFileSync(file, 'Merge resolved conflict');
  assert.equal(run(['--message-file', file], dir).status, 1);
  gitOk(dir, 'commit', '-m', '[fix] resolve conflict');
  const result = run(['--range', `${base}..HEAD`], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Checked 3 commit/);
});
