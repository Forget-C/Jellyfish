#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

function git(cwd, args, missingAllowed = false) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (missingAllowed && result.status === 1) return null;
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'Git command failed');
  return result.stdout.trim();
}

// Validate prerequisites before changing repository configuration.
function verifyFiles(root) {
  for (const [file, executable] of [
    ['.githooks/commit-msg', true],
    ['.githooks/prepare-commit-msg', true],
    ['scripts/check-commit-subject.mjs', false],
  ]) {
    const absolute = path.join(root, file);
    try {
      if (!statSync(absolute).isFile()) throw new Error();
      accessSync(absolute, constants.R_OK | (executable ? constants.X_OK : 0));
    } catch (error) {
      const reason = error.code === 'EACCES' ? 'not readable/executable' : 'missing or not a file';
      throw new Error(`${absolute}: ${reason}. Repair the tracked file/permissions, then run: node scripts/repository-hooks.mjs install`);
    }
  }
}

try {
  const [mode, ...args] = process.argv.slice(2);
  let target = process.cwd();
  let replaceCustom = false;
  if (!['check', 'install'].includes(mode)) throw new Error('Usage: node scripts/repository-hooks.mjs check|install [--repo PATH]');
  while (args.length) {
    const arg = args.shift();
    if (arg === '--repo' && args[0]) target = args.shift();
    else if (arg === '--replace-custom-hooks-path' && mode === 'install') replaceCustom = true;
    else throw new Error('Expected --repo PATH or install --replace-custom-hooks-path');
  }
  const root = git(target, ['rev-parse', '--show-toplevel']);
  const gitDir = git(root, ['rev-parse', '--absolute-git-dir']);
  const commonGitDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const repair = 'node scripts/repository-hooks.mjs install';
  const worktrees = mode === 'install'
    ? git(root, ['worktree', 'list', '--porcelain', '-z']).split('\0\0')
      .filter((record) => !record.split('\0').includes('bare'))
      .map((record) => record.split('\0').find((field) => field.startsWith('worktree '))?.slice(9)).filter(Boolean)
    : [root];
  const shared = git(root, ['config', '--local', '--get', 'core.hooksPath'], true);
  const configurations = worktrees.map((checkout) => ({
    checkout,
    configured: git(checkout, ['config', '--get', 'core.hooksPath'], true),
  }));
  const conflicts = configurations.filter(({ configured }) => configured !== null && configured !== '.githooks');
  if (mode === 'install' && shared !== null && shared !== '.githooks') conflicts.push({ checkout: commonGitDir, configured: shared });
  if (conflicts.length && !replaceCustom) {
    throw new Error(`Custom core.hooksPath preserved: ${conflicts.map(({ checkout, configured }) => `${checkout}: ${JSON.stringify(configured)}`).join('; ')}. To replace explicitly, run: ${repair} --replace-custom-hooks-path`);
  }
  for (const checkout of worktrees) verifyFiles(checkout);
  if (mode === 'install') {
    git(root, ['config', '--local', '--replace-all', 'core.hooksPath', '.githooks']);
    // --local targets the common config; existing worktree overrides need their own update.
    if (git(root, ['config', '--type=bool', '--get', 'extensions.worktreeConfig'], true) === 'true') {
      for (const checkout of worktrees) {
        const override = git(checkout, ['config', '--worktree', '--get', 'core.hooksPath'], true);
        if (override !== null && override !== '.githooks') git(checkout, ['config', '--worktree', '--replace-all', 'core.hooksPath', '.githooks']);
      }
    }
  }
  for (const checkout of worktrees) {
    if (git(checkout, ['config', '--get', 'core.hooksPath'], true) !== '.githooks') {
      throw new Error(`Repository hooks are not enabled in ${checkout}. Run: ${repair}`);
    }
  }
  console.log(`Repository hooks enabled: ${root}\ngitDir=${gitDir}\ncommonGitDir=${commonGitDir}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
