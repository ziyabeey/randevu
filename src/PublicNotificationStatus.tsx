import type { CustomerNotificationStatus, CustomerNotificationStatusCode } from '../shared/customer-notification-status';

const statusText: Record<CustomerNotificationStatusCode, string> = {
  not_requested: 'E-posta adresi verilmedi; e-posta gönderimi istenmedi.',
  queued: 'E-posta gönderim sırasına alındı.',
  sending: 'E-posta gönderiliyor.',
  accepted: 'E-posta sağlayıcı tarafından kabul edildi. Gelen kutusuna teslim edildiği doğrulanmaz.',
  failed: 'E-posta gönderilemedi.',
  unknown: 'E-posta gönderim sonucu doğrulanamıyor.',
};

export function customerNotificationStatusText(notification: CustomerNotificationStatus) {
  return statusText[notification.status];
}

export default function PublicNotificationStatus({ notification }: { notification: CustomerNotificationStatus }) {
  return <p><strong>Bildirim durumu:</strong> {customerNotificationStatusText(notification)}</p>;
}
