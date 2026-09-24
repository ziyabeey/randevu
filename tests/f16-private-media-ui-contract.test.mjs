import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const photos = await readFile(new URL('../src/AppointmentPhotos.tsx', import.meta.url), 'utf8');
const archive = await readFile(new URL('../src/PrivatePhotoArchive.tsx', import.meta.url), 'utf8');
const booking = await readFile(new URL('../src/BookingPage.tsx', import.meta.url), 'utf8');
const services = await readFile(new URL('../src/ServicesPage.tsx', import.meta.url), 'utf8');
const worker = await readFile(new URL('../worker/f16-private-media-http.ts', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/private-media.css', import.meta.url), 'utf8');

test('F16-03 private photos are only ever rendered through the authenticated content endpoint', () => {
  assert.match(photos, /src=\{photo\.contentUrl\}/);
  assert.match(worker, /contentUrl: `\/api\/private-media\/\$\{row\.id\}\/content`/);
  assert.doesNotMatch(worker, /createSignedUrl|\/object\/sign\/|\/object\/public\//);
  assert.match(worker, /'Cache-Control': 'private, no-store'/);
  assert.doesNotMatch(`${photos}${archive}`, /storage\/v1|supabase/i);
});

test('F16-03 publish is an explicit consent-gated action and staff never see it', () => {
  assert.match(photos, /disabled=\{busy \|\| !consent\}/);
  assert.match(photos, /açık onay aldım/);
  assert.match(photos, /photo\.canPublish && !photo\.published/);
  assert.match(photos, /consentConfirmed: true/);
});

test('F16-03 the booking detail exposes a real photo tab and the services page hosts the archive', () => {
  assert.match(booking, /import AppointmentPhotos from '\.\/AppointmentPhotos'/);
  assert.match(booking, /detailTab === 'photos' \? <AppointmentPhotos/);
  assert.doesNotMatch(booking, /Fotoğraf bölümü henüz kullanıma açık değil/);
  assert.match(services, /<PrivatePhotoArchive/);
  assert.match(archive, /Daha fazla fotoğraf/);
});

test('F16-03 upload keeps the K03 cap visible and a failed image never breaks the grid', () => {
  assert.match(photos, /const PHOTO_LIMIT = 10;/);
  assert.match(photos, /count < PHOTO_LIMIT && <form/);
  assert.match(photos, /onError=\{\(\) => setBroken\(true\)\}/);
  assert.match(photos, /preparePublicMedia\(file\)/);
  assert.match(css, /min-height: 2\.75rem/);
  assert.match(css, /@media \(max-width: 430px\)/);
});
