const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp } = require('./_helpers');

let ctx;
before(async () => { ctx = await setupTestApp('auth'); });
after(async () => { await teardownTestApp(ctx); });

test('login with correct credentials returns a real JWT via real bcrypt', async () => {
    const res = await request(ctx.app).post('/auth/login').send({
        email: 'admin@test.local', password: 'Test1234!'
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, true);
    assert.ok(res.body.authToken && res.body.authToken.split('.').length === 3, 'looks like a real JWT');
});

test('login with wrong password is rejected', async () => {
    const res = await request(ctx.app).post('/auth/login').send({
        email: 'admin@test.local', password: 'wrong-password'
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.status, false);
});

test('login with unknown email is rejected', async () => {
    const res = await request(ctx.app).post('/auth/login').send({
        email: 'nobody@test.local', password: 'Test1234!'
    });
    assert.equal(res.status, 400);
});
