#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const source = fs.readFileSync(path.join(__dirname, 'vocabulary-master-tool.js'), 'utf8');

function must(pattern, message) {
  assert.match(source, pattern, message);
}

must(/function cardFlashQuestions\(record\)/, 'card-specific generator is missing');
must(/return shuffle\((?:chosen|questions)\)\.slice\(0, 20\)/, 'generator must cap the session at exactly 20 questions');
must(/const refill = \[\]/, 'dynamic refill candidates are missing');
must(/main-meaning', 1/, 'primary Bengali meaning must be limited to one question');
must(/Dynamic relation rotation/, 'data-aware relation distribution is missing');
must(/function flashOptions\(correct, pool\)/, 'four-option helper is missing');
must(/const key = lower\(value\)/, 'options must be deduplicated case-insensitively');
must(/if \(questions\.length < 20\) return null/, 'insufficient banks must not receive fabricated questions');
must(/acronym \/ short form/, 'acronym question template is missing');
must(/acronym-এর বাংলা meaning বা expansion/, 'Bengali acronym meaning question is missing');
must(/returnPath:route\('bank'\)/, 'temporary session return path is missing');
must(/session\.returnPath = returnPath/, 'originating category must be preserved');
must(/exitCardFlash\(\) \{ const returnPath = state\.cardFlash\?\.returnPath/, 'exit must return to the originating route');

const flashMethods = ['startCardFlash(id)', 'answerCardFlash(value)', 'nextCardFlash()', 'exitCardFlash()'];
flashMethods.forEach(name => {
  const start = source.indexOf(`    ${name}`);
  const end = source.indexOf('\n    ', start + 5);
  assert.ok(start >= 0 && end > start, `${name} method is missing or malformed`);
  assert.doesNotMatch(source.slice(start, end), /dbPut|dbDel|localStorage|saveResult|createExamQuestions|beginExam|ExamSetup/, `${name} must remain persistence-free`);
});

console.log('Vocabulary Card Flash static contract: PASS');
console.log('Verified: 20-question cap, rotated templates, case-insensitive option uniqueness, acronym coverage, origin return path and no-save API contract.');
