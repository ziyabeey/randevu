import { useState } from 'react';
import KolayAppShell from './KolayAppShell';
import KolayAppointmentsHome from './KolayAppointmentsHome';
import KolayUnavailablePanel from './KolayUnavailablePanel';
import type { KolayAppTab } from './model';

const unavailableCopy: Record<Exclude<KolayAppTab, 'appointments'>, { title: string; description: string }> = {
  tickets: {
    title: 'Adisyonlar',
    description: 'Adisyon ve tahsilat domaini bu spike kapsamında bağlı değil. F14 mali akışı hazır olduğunda bu sekme aynı kabukta gerçek sunucu sonucunu gösterecek.',
  },
  new: {
    title: 'Yeni',
    description: 'Yeni randevu ve sonraki satış/masraf girişleri production bağımlılıkları açılınca canonical işlem akışlarına bağlanacak.',
  },
  customers: {
    title: 'Müşteriler',
    description: 'Mevcut müşteri domaini bu izole spike içinde route edilmez. F14-01 sırasında ortak işletme/session bağlamından beslenecek.',
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
      business={{ name: 'Örnek işletme bağlamı', meta: 'API bağlı değil' }}
    >
      {activeTab === 'appointments' ? (
        <KolayAppointmentsHome
          dateLabel="Bugün"
          items={[]}
          emptyTitle="Randevu verisi bağlı değil"
          emptyDescription="Bu spike yalnız mobil kabuğu doğrular. Canonical takvim verisi F13/F14 entegrasyonunda dışarıdan beslenecek."
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
