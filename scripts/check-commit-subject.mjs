#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const types = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'ci', 'build', 'revert'];

// Check the actual first line; merge/revert messages use the same contract.
function reason(subject) {
  if (!subject.trim()) return '标题不能为空';
  const match = /^\[([^\]]+)\](.*)$/.exec(subject);
  if (!match || !types.includes(match[1])) return `类型必须为小写枚举：${types.join(', ')}`;
  if (!match[2].startsWith(' ')) return '类型后必须使用空格分隔摘要';
  if (!match[2].trim()) return '摘要不能为空';
  return null;
}

// Resolve endpoints before listing commits so a broken range cannot look empty.
function commitsInRange(range) {
  const endpoints = range.split('..');
  if (endpoints.length !== 2 || endpoints.some((ref) => !ref || ref.startsWith('-') || ref.includes('..'))) {
    throw new Error('Invalid commit range: expected BASE..HEAD');
  }
  const revisions = endpoints.map((ref) => git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim());
  return git(['rev-list', `${revisions[0]}..${revisions[1]}`]).trim().split('\n').filter(Boolean);
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

try {
  const [mode, input, ...extra] = process.argv.slice(2);
  if (!['--message-file', '--range'].includes(mode) || !input || extra.length) {
    throw new Error('Usage: node scripts/check-commit-subject.mjs --message-file PATH | --range BASE..HEAD');
  }
  const subjects = mode === '--message-file'
    ? [{ identity: input, subject: readFileSync(input, 'utf8').split(/\r?\n/, 1)[0] }]
    : commitsInRange(input).map((sha) => ({ identity: sha, subject: git(['show', '-s', '--format=%B', sha]).split('\n', 1)[0] }));
  let invalid = false;
  for (const { identity, subject } of subjects) {
    const error = reason(subject);
    if (error) {
      console.error(`Invalid commit subject ${identity} ${JSON.stringify(subject)}: ${error}；首行须为 "[类型] 摘要"`);
      invalid = true;
    }
  }
  if (invalid) process.exitCode = 1;
  else console.log(subjects.length ? `Checked ${subjects.length} commit subject(s).` : 'No commits to check.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
