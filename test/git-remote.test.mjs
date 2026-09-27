import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';

// Lista otwartych PR / MR (git-remote.js listPRs) na podstawionym fetch — GitHub, GitLab, Bitbucket.
const calls = [];
const routes = {
  'https://api.github.com/repos/o/r/pulls?state=open&sort=updated&direction=desc&per_page=30':
    [{ number: 12, title: 'Nowy parser', user: { login: 'ala' }, draft: true, updated_at: '2026-09-20T10:00:00Z', html_url: 'https://github.com/o/r/pull/12' }],
  'https://gitlab.com/api/v4/projects/g%2Fp/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=30':
    [{ iid: 7, title: 'MR', author: { username: 'bob' }, draft: false, updated_at: '2026-09-21T10:00:00Z', web_url: 'https://gitlab.com/g/p/-/merge_requests/7' }],
  'https://api.bitbucket.org/2.0/repositories/b/q/pullrequests?state=OPEN&sort=-updated_on&pagelen=30':
    { values: [{ id: 3, title: 'BB', author: { nickname: 'cid' }, updated_on: '2026-09-22T10:00:00Z', links: { html: { href: 'https://bitbucket.org/b/q/pull-requests/3' } } }] },
};
const fetch = async (u) => { calls.push(u); const body = routes[u]; return new Response(JSON.stringify(body ?? { message: 'nf' }), { status: body ? 200 : 404, headers: { 'content-type': 'application/json' } }); };
const CM = loadCM(['util', 'i18n', 'git-remote'], { fetch, Response });
const R = CM.GitRemote;

describe('listPRs — otwarte pull / merge requesty', () => {
  test('GitHub, GitLab, Bitbucket → wspólny format; repozytorium spoza hostingu → pusto bez zapytań', async () => {
    assert.deepEqual(host(await R.listPRs({ host: 'github', repo: 'o/r' })),
      [{ number: 12, title: 'Nowy parser', author: 'ala', draft: true, updated: Date.parse('2026-09-20T10:00:00Z'), url: 'https://github.com/o/r/pull/12' }]);
    assert.deepEqual(host((await R.listPRs({ host: 'gitlab', repo: 'g/p' })).map((p) => [p.number, p.author, p.draft])), [[7, 'bob', false]]);
    assert.deepEqual(host((await R.listPRs({ host: 'bitbucket', repo: 'b/q' })).map((p) => [p.number, p.author, p.url])), [[3, 'cid', 'https://bitbucket.org/b/q/pull-requests/3']]);
    const n = calls.length;
    assert.deepEqual(host(await R.listPRs({ kind: 'local', name: 'x' })), []);
    assert.equal(calls.length, n);
  });
});
