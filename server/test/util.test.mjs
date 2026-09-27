// Pomocnicze funkcje serwera (server/util.js): tokeny, skróty, porównanie w stałym czasie, walidacja danych konta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomToken, sha256hex, safeEqual, validEmail, validPassword, normLang } from '../util.js';

test('randomToken: base64url bez dopełnienia, długość z liczby bajtów, za każdym razem inny', () => {
  const t = randomToken();
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(randomToken(18).length, 24);
  assert.notEqual(randomToken(), randomToken());
});

test('sha256hex: znany skrót; safeEqual: równe / różne / różnej długości / nie-napisy', () => {
  assert.equal(sha256hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(safeEqual('token', 'token'), true);
  assert.equal(safeEqual('token', 'tokex'), false);
  assert.equal(safeEqual('token', 'token2'), false);
  assert.equal(safeEqual(123, '123'), true);
});

test('validEmail: typowe adresy tak; spacje, brak domeny/TLD, za długie, nie-napis — nie', () => {
  for (const e of ['a@b.pl', 'ala.kowalska+tag@sub.example.com', 'x@y.co']) assert.equal(validEmail(e), true, e);
  for (const e of ['', 'a b@c.pl', 'a@b', 'a@b.c', '@b.pl', 'a@@b.pl', 'x'.repeat(65) + '@b.pl', 'a@' + 'b'.repeat(250) + '.pl', null, 5, ['a@b.pl']])
    assert.equal(validEmail(e), false, String(e));
});

test('validPassword: 10–200 znaków napisu; normLang: tylko en albo pl', () => {
  assert.equal(validPassword('x'.repeat(10)), true); assert.equal(validPassword('x'.repeat(200)), true);
  assert.equal(validPassword('x'.repeat(9)), false); assert.equal(validPassword('x'.repeat(201)), false); assert.equal(validPassword(1234567890), false);
  assert.deepEqual(['en', 'pl', 'de', undefined, 'EN'].map(normLang), ['en', 'pl', 'pl', 'pl', 'pl']);
});
