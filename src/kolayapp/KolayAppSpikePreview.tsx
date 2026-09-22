import { useState } from 'react';
import KolayAppShell from './KolayAppShell';
import KolayAppointmentsHome from './KolayAppointmentsHome';
import KolayUnavailablePanel from './KolayUnavailablePanel';
import type { KolayAppTab } from './model';

const unavailableCopy: Record<Exclude<KolayAppTab, 'appointments'>, { title: string; description: string }> = {
  tickets: {
    title: 'Adisyonlar',
    description: 'Adisyon ve tahsilat bu önizlemeye bağlı değil. Hazır olduğunda bu sekme gerçek sunucu sonucunu gösterecek.',
  },
  new: {
    title: 'Yeni',
    description: 'Yeni randevu ve sonraki satış/masraf girişleri hazır oldukça bu bölümde açılacak.',
  },
  customers: {
    title: 'Müşteriler',
    description: 'Müşteri kayıtları hazır olduğunda seçili işletmeye göre burada gösterilecek.',
  },
  more: {
    title: 'Diğer',
    description: 'Salon, ekip, hizmet, mesai, destek ve sonraki rapor bağlantıları hazır oldukça bu gruba kontrollü biçimde eklenecek.',
  },
};

export default function KolayAppSpikePreview() {
  const [activeTab, setActiveTab] = useState<KolayAppTab>('appointments');

  return (
    <KolayAppShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      business={{ name: 'Örnek işletme', meta: 'Önizleme' }}
    >
      {activeTab === 'appointments' ? (
        <KolayAppointmentsHome
          dateLabel="Bugün"
          items={[]}
          emptyTitle="Randevu verisi bağlı değil"
          emptyDescription="Randevu verileri hazır olduğunda bu alanda gösterilecek."
        />
      ) : (
        <KolayUnavailablePanel
          title={unavailableCopy[activeTab].title}
          description={unavailableCopy[activeTab].description}
        />
      )}
    </KolayAppShell>
  );
}
