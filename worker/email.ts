export type EmailEnv = {
  RESEND_API_KEY?: string;
  NOTIFICATION_FROM_EMAIL?: string;
};

export type PublicBookingEmailPayload = {
  appointmentId: string;
  businessName: string;
  customerName: string;
  customerEmail: string;
  startsAt: string;
  timezone: string;
  serviceName: string;
  staffName: string;
  priceMinor: number;
  currency: string;
  manageUrl: string;
};

export type EmailDeliveryResult =
  | { status: 'sent'; providerMessageId: string }
  | { status: 'disabled' }
  | { status: 'failed' };

type ResendResponse = { id?: string };

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: timezone,
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatMoney(minor: number, currency: string) {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
  }).format(minor / 100);
}

export async function sendPublicBookingConfirmation(
  env: EmailEnv,
  payload: PublicBookingEmailPayload,
): Promise<EmailDeliveryResult> {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.NOTIFICATION_FROM_EMAIL?.trim();
  if (!apiKey || !from) return { status: 'disabled' };

  const dateTime = formatDateTime(payload.startsAt, payload.timezone);
  const price = formatMoney(payload.priceMinor, payload.currency);
  const business = escapeHtml(payload.businessName);
  const customer = escapeHtml(payload.customerName);
  const service = escapeHtml(payload.serviceName);
  const staff = escapeHtml(payload.staffName);
  const manageUrl = escapeHtml(payload.manageUrl);

  const text = [
    `Merhaba ${payload.customerName},`,
    '',
    `${payload.businessName} randevunuz oluşturuldu.`,
    `Hizmet: ${payload.serviceName}`,
    `Personel: ${payload.staffName}`,
    `Tarih: ${dateTime}`,
    `Ücret: ${price}`,
    '',
    'Randevunuzu görüntülemek, taşımak veya iptal etmek için:',
    payload.manageUrl,
    '',
    'Bu bağlantı randevunuzu yönetme yetkisi verir. Başkalarıyla paylaşmayın.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="tr">
  <body style="font-family:Arial,sans-serif;background:#f7f7f8;color:#18181b;margin:0;padding:32px 16px">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;padding:28px">
      <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;color:#71717a">RANDEVU ONAYI</p>
      <h1 style="font-size:24px;margin:0 0 20px">${business}</h1>
      <p>Merhaba ${customer}, randevunuz oluşturuldu.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr><td style="padding:8px 0;color:#71717a">Hizmet</td><td style="padding:8px 0;text-align:right">${service}</td></tr>
        <tr><td style="padding:8px 0;color:#71717a">Personel</td><td style="padding:8px 0;text-align:right">${staff}</td></tr>
        <tr><td style="padding:8px 0;color:#71717a">Tarih</td><td style="padding:8px 0;text-align:right">${escapeHtml(dateTime)}</td></tr>
        <tr><td style="padding:8px 0;color:#71717a">Ücret</td><td style="padding:8px 0;text-align:right">${escapeHtml(price)}</td></tr>
      </table>
      <p style="margin:24px 0"><a href="${manageUrl}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px">Randevumu yönet</a></p>
      <p style="font-size:13px;color:#71717a">Bu bağlantı randevuyu görüntüleme, taşıma ve iptal etme yetkisi verir. Başkalarıyla paylaşmayın.</p>
    </div>
  </body>
</html>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `public-booking-confirmation/${payload.appointmentId}`,
      },
      body: JSON.stringify({
        from,
        to: [payload.customerEmail],
        subject: `${payload.businessName} randevu onayı`,
        text,
        html,
        tags: [
          { name: 'category', value: 'booking_confirmation' },
          { name: 'appointment', value: payload.appointmentId },
        ],
      }),
    });

    if (!response.ok) return { status: 'failed' };
    const data = await response.json() as ResendResponse;
    if (!data.id) return { status: 'failed' };
    return { status: 'sent', providerMessageId: data.id };
  } catch {
    return { status: 'failed' };
  }
}
