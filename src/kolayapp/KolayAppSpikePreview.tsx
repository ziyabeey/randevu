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
    description: 'Yeni randevu ve sonraki satış/masraf girişleri production bağımlılıkları açılınca canonical işlem akışlarına bağlanacak.',
  },
  customers: {
    title: 'Müşteriler',
    description: 'Müşteri kayıtları bu önizlemeye bağlı değil. Production entegrasyonunda ortak işletme bağlamı kullanılacak.',
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
