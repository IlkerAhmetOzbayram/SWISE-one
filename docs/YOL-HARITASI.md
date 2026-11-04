# SWISE One – Yol Haritası

SWISE Teknoloji ve Danışmanlık'ın şirket içi iş uygulaması (küçük ERP).
Her faz ayrı bir dalda (`faz-N/...`) geliştirilir, test edilir, onaylandıktan sonra `main`'e birleştirilir.

## Alınan kararlar (04.11.2026)

| Konu | Karar |
|---|---|
| Para birimi | TL, EUR ve USD — müşteri/teklif/fatura bazında değişebilir |
| Erişim | Ekip internetten girecek; uygulama bulut sunucuda çalışacak |
| Aylık bütçe tahmini | İki ayrı gösterim: (1) şu ana kadarki tempoya göre ay sonu tahmini, (2) önceden girilmiş plan varsa plan–gerçekleşen karşılaştırması |
| E-imza | Token ile e-imza mevcut; mobil imza da kullanılabilir |
| Kurumsal mail | Microsoft 365 |
| Bordro | Muhasebeciden alınıyor; uygulama hesaplamaz, tutarları kaydeder |
| Ücret | Müşteri ücreti günlük girilir; 1 gün = 8 saat |
| Müşteri yapısı | Müşteri (grup) → Şirket (fatura birimi) → Proje. Ücret önceliği proje → şirket → müşteri |
| Fatura bilgileri | Şirkette tutulur (her şirket ayrı tüzel kişi) |
| Para birimi seviyesi | Müşteride varsayılan, şirkette değiştirilebilir |
| İletişim kişileri | Müşteri geneline veya belirli bir şirkete bağlanabilir |
| Rapor dökümü | Müşteri → Şirket → Proje; para birimleri ayrı toplanır |

## Fazlar

| Faz | Kapsam | Durum |
|---|---|---|
| 0 | Altyapı: modüler yapı, veritabanı geçişleri, işlem kaydı, otomatik yedek, bulut güvenliği, testler | ✅ Tamamlandı (04.11.2026) |
| 1 | Müşteri yapısı: müşteri → şirket → proje, fatura bilgileri, iletişim kişileri, günlük ücret (8 saat), para birimi, ödeme vadesi, KDV muafiyeti | ✅ Tamamlandı — onay bekliyor |
| 2 | Aktivite ve raporlama: günlük/haftalık/aylık görünüm, Excel, mail ile paylaşım, müşteri filtresi, aylık bütçe tahmini ve plan | ⏳ |
| 3 | Personel, yönetim, yetkilendirme: personel kartı, roller, yetki matrisi, KVKK | ⏳ |
| 4 | Teklif: şablon, hazırlama, PDF, e-imza (token/mobil), mail ile gönderim, arşiv, durum takibi | ⏳ |
| 5 | Muhasebe: gelir/gider hareketleri, gelen/giden fatura, cari bakiye, personel cari (maaş, SGK, avans), aylık bütçe raporu | ⏳ |
| 6 | Entegrasyonlar: Microsoft 365 mail, e-imza servisi, e-fatura entegratörü, banka hareketleri, bulut kurulumu | ⏳ |

Fazların sırası bağımlılıklara göre belirlendi: teklif ve muhasebe müşteri kaydına,
maaş/cari gibi hassas veriler ise yetkilendirmeye dayanır.

## Faz ayrıntıları

### Faz 0 – Altyapı
- Sunucu ve arayüz kodunun modüllere ayrılması (`src/modules/*`, `public/js/*`)
- Veritabanı geçiş (migration) sistemi: şema değişiklikleri mevcut veriyi bozmadan uygulanır
- İşlem kaydı (audit log): kim, neyi, ne zaman değiştirdi — eski ve yeni değerlerle
- Otomatik günlük veritabanı yedeği ve yöneticinin yedek indirebilmesi
- Bulut için güvenlik: güvenlik başlıkları, HTTPS'te güvenli çerez, giriş denemesi sınırı
- Otomatik testler (hesaplamalar, yetkiler, geçişler, yedek)

### Faz 1 – Müşteri kaydı
- Unvan, VKN/TCKN, vergi dairesi, adres, e-posta, telefon
- Birden fazla iletişim kişisi
- Günlük ücret (1 gün = 8 saat), proje bazında farklı ücret
- Para birimi (TL/EUR/USD) — müşteri varsayılanı, projede değiştirilebilir
- Ödeme vadesi

### Faz 2 – Aktivite ve raporlama
- Günlük, haftalık, aylık görünüm; saat ve adam-gün
- Müşteri bazında filtreleme
- Excel indirme, raporun mail ile paylaşılması (Microsoft 365)
- Aylık bütçe: tempoya göre tahmin + plan–gerçekleşen karşılaştırması

### Faz 3 – Personel, yönetim, yetkilendirme
- Personel kartı (maaş bilgisi yalnızca yetkiliye görünür)
- Roller: Yönetici, Muhasebe, Proje Yöneticisi, Çalışan (+ özel roller)
- Modül bazında görme/ekleme/düzenleme/onaylama yetkileri
- KVKK: hassas veriye erişim kaydı

### Faz 4 – Teklif
- SWISE şablonu, kalemler (adam-gün × günlük ücret + ek kalemler), döviz desteği
- PDF üretimi
- E-imza: kısa vadede PDF indirilip token/mobil imza ile imzalanır ve yüklenir; sonra servis entegrasyonu
- Microsoft 365 üzerinden mail ile gönderim
- Sürümlü arşiv; durum: taslak → gönderildi → kabul/red; kabul edilen teklif projeye dönüşür

### Faz 5 – Muhasebe
- Gelir/gider hesap hareketleri (banka/kasa, kategori, döviz)
- Giden fatura (aktivite veya kabul edilmiş tekliften taslak), gelen fatura (tedarikçi)
- Müşteri ve tedarikçi cari bakiyesi, vade takibi
- Personel cari: maaş, SGK, avans, kesinti (bordro tutarları muhasebeciden)
- Aylık bütçe raporu (plan–gerçekleşen)
- Not: resmi e-fatura/e-arşiv kesilmez; Faz 6'da entegratörle bağlanır

### Faz 6 – Entegrasyonlar
Microsoft 365 (mail, takvim), e-imza servisi, e-fatura/e-arşiv entegratörü, banka hareketleri, bulut sunucu kurulumu.
