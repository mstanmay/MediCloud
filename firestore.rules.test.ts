import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rulesText = fs.readFileSync(rulesPath, 'utf8');

test('firestore.rules enforces global default deny catch-all', () => {
  assert.match(rulesText, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
});

test('firestore.rules isolates PII and prevents self role escalation', () => {
  assert.match(rulesText, /match \/private\/\{docId\}/);
  assert.match(rulesText, /incoming\(\)\.role == 'PATIENT'/);
  assert.match(rulesText, /request\.auth\.token\.email_verified == true/);
});

test('firestore.rules enforces least-privilege on medicalRecords and immutable auditLogs', () => {
  const medSection = rulesText.split('match /medicalRecords/{recordId}')[1].split('match /recordSharingPermissions')[0];
  assert.equal(medSection.includes('isAdmin()'), false);
  const auditSection = rulesText.split('match /auditLogs/{logId}')[1];
  assert.match(auditSection, /allow update, delete: if false;/);
});
