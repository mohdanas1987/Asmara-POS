'use strict';
/**
 * Customer-display media security hardening (CTO feedback 2026-09-22, item 22). Before this,
 * POST /config/customer-display/media had no file-size limit at all, and validated file TYPE
 * only by the client-supplied filename's extension -- trivially spoofed by renaming any file
 * to end in ".mp4". A file claiming to be a video was copied to disk and served statically
 * completely unvalidated by content.
 *
 * Fixed: a 100MB upload cap (via multer's own `limits`, not independently re-tested against a
 * real 100MB+ fixture here -- that's multer's own well-established behavior, not this
 * codebase's logic, and writing a 100MB test fixture just to prove it would slow down the
 * whole suite for no real additional confidence), plus real magic-byte validation for the
 * video path (the image path already gets this for free -- sharp actually decodes the file).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestApp, teardownTestApp, loginAsAdmin } = require('./_helpers');

let ctx;
let token;
const tmpFiles = [];

function writeTempFile(name, bytes) {
    const filePath = path.join(os.tmpdir(), `${Date.now()}-${name}`);
    fs.writeFileSync(filePath, bytes);
    tmpFiles.push(filePath);
    return filePath;
}

before(async () => {
    ctx = await setupTestApp('customer-display-media-hardening');
    token = await loginAsAdmin(request, ctx.app);
});

after(async () => {
    await teardownTestApp(ctx);
    for (const f of tmpFiles) {
        try { fs.unlinkSync(f); } catch (e) { /* best-effort cleanup */ }
    }
});

test('a file with real MP4 magic bytes, renamed with a .mp4 extension, is accepted', async () => {
    // Minimal ISO-BMFF box header: 4-byte size + 'ftyp' box type -- exactly what
    // looksLikeRealVideo() checks for, without needing a fully valid, playable MP4.
    const realMp4 = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(8)]);
    const filePath = writeTempFile('real.mp4', realMp4);

    const res = await request(ctx.app)
        .post('/config/customer-display/media')
        .set('asmara-token', token)
        .attach('file', filePath, 'real.mp4');

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.item.type, 'video');
});

test('a plain text file renamed to .mp4 (fake video) is rejected, not silently accepted', async () => {
    const fakeMp4 = Buffer.from('<script>this is not a real video, just renamed</script>');
    const filePath = writeTempFile('fake.mp4', fakeMp4);

    const res = await request(ctx.app)
        .post('/config/customer-display/media')
        .set('asmara-token', token)
        .attach('file', filePath, 'fake.mp4');

    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /doesn't match a real/i);

    const list = await request(ctx.app).get('/config/customer-display/media').set('asmara-token', token);
    assert.ok(!list.body.media.some((m) => m.name === 'fake.mp4'), 'the rejected file must never be added to the media list');
});

test('a real WebM (EBML magic bytes) is accepted', async () => {
    const realWebm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(12)]);
    const filePath = writeTempFile('real.webm', realWebm);

    const res = await request(ctx.app)
        .post('/config/customer-display/media')
        .set('asmara-token', token)
        .attach('file', filePath, 'real.webm');

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.item.type, 'video');
});

test('a real image still uploads fine, unaffected by the video hardening (image path is validated by sharp actually decoding it)', async () => {
    // 1x1 transparent PNG.
    const pngBytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
    );
    const filePath = writeTempFile('real.png', pngBytes);

    const res = await request(ctx.app)
        .post('/config/customer-display/media')
        .set('asmara-token', token)
        .attach('file', filePath, 'real.png');

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.item.type, 'image');
});

test('a cashier (no settings.manage) cannot upload customer-display media at all', async () => {
    const { seedStaffUser } = require('./_helpers');
    const cashierToken = await seedStaffUser(request, ctx.app, ctx.knex, { email: 'cashier-cdm@test.local', role: 'cashier' });
    const realMp4 = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(8)]);
    const filePath = writeTempFile('cashier.mp4', realMp4);

    const res = await request(ctx.app)
        .post('/config/customer-display/media')
        .set('asmara-token', cashierToken)
        .attach('file', filePath, 'cashier.mp4');

    assert.equal(res.status, 403, JSON.stringify(res.body));
});
