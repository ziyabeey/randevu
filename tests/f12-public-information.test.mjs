import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const information=readFileSync(new URL('../src/PublicBookingInformation.tsx',import.meta.url),'utf8');
const booking=readFileSync(new URL('../src/PublicBookingPage.tsx',import.meta.url),'utf8');
const salon=readFileSync(new URL('../src/PublicSalonPage.tsx',import.meta.url),'utf8');
const manage=readFileSync(new URL('../src/ManageAppointmentPage.tsx',import.meta.url),'utf8');
const recovery=readFileSync(new URL('../worker/public-booking-recovery.ts',import.meta.url),'utf8');
const group=readFileSync(new URL('../worker/f11-group-http.ts',import.meta.url),'utf8');
const baseMigration=readFileSync(new URL('../supabase/migrations/20260921083000_f12_booking_information_links.sql',import.meta.url),'utf8');
const ownerContentMigration=readFileSync(new URL('../supabase/migrations/20260921114500_f12_booking_information_owner_content.sql',import.meta.url),'utf8');

test('F12-05 exposes accessible information, privacy, terms and real support surfaces',()=>{
  for(const label of ['Aydınlatma ve KVKK','Gizlilik','Randevu koşulları','Destek']) assert.match(information,new RegExp(label));
  assert.match(information,/informationBase/);
  assert.match(information,/encodeURIComponent\(slug\)/);
  assert.match(information,/\/kvkk/);
  assert.match(information,/\/privacy/);
  assert.match(information,/\/terms/);
  assert.match(information,/\/support/);
  assert.match(information,/target="_blank"/);
  assert.match(information,/kvkkNoticeText/);
  assert.match(information,/kvkkNoticeUrl/);
  assert.match(information,/privacyPolicyUrl/);
  assert.match(information,/bookingTermsText/);
  assert.match(information,/bookingTermsUrl/);
  assert.match(information,/tel:/);
  assert.match(information,/mailto:/);
  assert.match(information,/wa\.me/);
});

test('F12-05 never synthesizes legal claims in the public information component or canonical pages',()=>{
  for(const source of [information,salon]){
    assert.doesNotMatch(source,/KVKK m\.11/);
    assert.doesNotMatch(source,/özel nitelikli kişisel veri/);
    assert.doesNotMatch(source,/KVKK m\.5/);
    assert.doesNotMatch(source,/teknik hizmet sağlayıcılara.*aktarılabilir/s);
  }
  assert.match(information,/İşletmenin yayınladığı/);
  assert.match(salon,/İşletmenin yayınladığı/);
});

test('F12-05 binds form, result and management information to the salon-published contract',()=>{
  assert.match(salon,/kvkkNoticeText: profile\.kvkk_notice_text/);
  assert.match(salon,/privacyPolicyUrl: profile\.privacy_policy_url/);
  assert.match(booking,/hasPublicBookingInformation\(informationContact\)/);
  assert.match(booking,/prefix="group-booking"/);
  assert.match(booking,/prefix="booking"/);
  assert.match(booking,/prefix="result"/);
  assert.match(booking,/!informationReady/);
  assert.match(manage,/kvkk_notice_text/);
  assert.match(manage,/privacy_policy_url/);
  assert.match(manage,/booking_terms_text/);
  assert.match(manage,/prefix="manage"/);
});

test('F12-05 support and operator-published information are capability scoped and fail closed',()=>{
  assert.match(baseMigration,/PUBLIC_CONTACT_REQUIRED/);
  assert.match(baseMigration,/f12_public_support_contact_guard/);
  assert.match(baseMigration,/where b\.id = p_business_id for update/);
  assert.match(ownerContentMigration,/kvkk_notice_text/);
  assert.match(ownerContentMigration,/privacy_policy_url/);
  assert.match(ownerContentMigration,/booking_terms_text/);
  assert.match(ownerContentMigration,/PUBLIC_INFORMATION_REQUIRED/);
  assert.match(ownerContentMigration,/f12_public_information_guard/);
  assert.match(ownerContentMigration,/get_public_business_profile_v2/);
  assert.match(ownerContentMigration,/from public\.get_public_business_profile_v2/);
  assert.match(ownerContentMigration,/support_slug text/);
  assert.match(ownerContentMigration,/revoke all on function public\.get_public_managed_appointment\(text\)/);
});

test('F12-05 checks published information server-side before single and group create',()=>{
  for(const source of [recovery,group]){
    const profileGate=source.indexOf("'profile'");
    const createGate=Math.max(source.indexOf("'book'"),source.indexOf("'group_book'"));
    assert.ok(profileGate>=0);
    assert.ok(createGate>profileGate);
    assert.match(source,/hasRequiredPublicBookingInformation/);
    assert.match(source,/PUBLIC_INFORMATION_REQUIRED/);
  }
});
