import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  buildPasswordAuthRequest,
  buildRegistrationEmail,
} from './auth-gateway';

test('login auth request keeps username and password only', () => {
  const payload = buildPasswordAuthRequest('login', 'teacher01', 'secret123');

  assert.deepEqual(payload, {
    mode: 'login',
    username: 'teacher01',
    password: 'secret123',
  });
});

test('register auth request derives a stable placeholder email', () => {
  const payload = buildPasswordAuthRequest(
    'register',
    '乡村教师-A',
    'secret123',
  );

  assert.equal(payload.mode, 'register');
  assert.equal(payload.username, '乡村教师-A');
  assert.equal(payload.password, 'secret123');
  assert.match(payload.email ?? '', /^user-a-[a-f0-9]{8}@eduskill\.localhost$/);
});

test('registration email falls back to a safe local part when username is fully non-ascii', () => {
  assert.match(
    buildRegistrationEmail('乡村老师'),
    /^user-[a-f0-9]{8}@eduskill\.localhost$/,
  );
});
