import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const information=readFileSync(new URL('../src/PublicBookingInformation.tsx',import.meta.url),'utf8');
const booking=readFileSync(new URL('../src/PublicBookingPage.tsx',import.meta.url),'utf8');
const salon=readFileSync(new URL('../src/PublicSalonPage.tsx',import.meta.url),'utf8');
const manage=readFileSync(new URL('../src/ManageAppointmentPage.tsx',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20260921083000_f12_booking_information_links.sql',import.meta.url),'utf8');

test('F12-05 exposes accessible information, privacy, terms and real support surfaces',()=>{
  for(const label of ['Aydınlatma ve KVKK','Gizlilik','Randevu koşulları','Destek']) assert.match(information,new RegExp(label));
  assert.match(information,/informationBase/);
  assert.match(information,/encodeURIComponent\(slug\)/);
  assert.match(information,/\/kvkk/);
  assert.match(information,/\/privacy/);
  assert.match(information,/\/terms/);
  assert.match(information,/\/support/);
  assert.match(information,/target=\"_blank\"/);
  assert.match(information,/KVKK m\.11/);
  assert.match(information,/özel nitelikli kişisel veri/);
  assert.match(information,/kapora, cayma bedeli/);
  assert.match(information,/tel:/);
  assert.match(information,/mailto:/);
  assert.match(information,/wa\.me/);
});

test('F12-05 binds form, result and management information to the salon contact',()=>{
  assert.match(salon,/informationContact=\{profile \?/);
  assert.match(booking,/hasPublicSupportContact\(informationContact\)/);
  assert.match(booking,/prefix="group-booking"/);
  assert.match(booking,/prefix="booking"/);
  assert.match(booking,/prefix="result"/);
  assert.match(booking,/!informationReady/);
  assert.match(manage,/support_slug/);
  assert.match(manage,/support_phone/);
  assert.match(manage,/slug=\{appointment\.support_slug\}/);
  assert.match(manage,/prefix="manage"/);
});

test('F12-05 readiness and capability view fail closed around a real support contact',()=>{
  assert.match(migration,/PUBLIC_CONTACT_REQUIRED/);
  assert.match(migration,/and f\.has_public_contact as publishable/);
  assert.match(migration,/f12_public_support_contact_guard/);
  assert.match(migration,/where b\.id = p_business_id for update/);
  assert.match(migration,/update_public_booking_settings/);
  assert.match(migration,/drop function public\.get_public_managed_appointment\(text\)/);
  assert.match(migration,/support_slug text/);
  assert.match(migration,/support_phone text/);
  assert.match(migration,/revoke all on function public\.get_public_managed_appointment\(text\)/);
});
