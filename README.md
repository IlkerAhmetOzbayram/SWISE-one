# SWISE One

SWISE Teknoloji ve Danışmanlık'ın şirket içi iş uygulaması (küçük ERP).

Mevcut modüller: aktivite girişi ve efor takibi, masraf takibi, müşteri/proje yönetimi, muhasebe raporu.
Planlanan: teklif hazırlama ve gönderme, cari hesap takibi.

## Çalıştırma

Gereksinim: Node.js 24 veya üzeri (yerleşik SQLite kullanılır).

```bash
npm install
npm start
```

Tarayıcıda http://localhost:3000 adresini açın. İlk açılışta şirket adı ve yönetici hesabı oluşturulur.
Veriler proje klasöründeki `data.db` dosyasında tutulur; yedek almak için bu dosyayı kopyalamanız yeterli.
Port ve veritabanı yolu `PORT` ve `DB_PATH` ortam değişkenleriyle değiştirilebilir.

## Roller

- **Yönetici**: müşteri/proje/kullanıcı tanımlar, tüm kayıtları görür ve düzenler, muhasebe raporunu alır, ayarları değiştirir.
- **Çalışan**: yalnızca kendi aktivite ve masraflarını girer/düzenler; ücret bilgilerini görmez.

## Ücret ve rapor hesapları

Saatlik ücret önceliği: proje ücreti → müşteri varsayılan ücreti → kullanıcı ücreti.
Ücret aktivite girildiği anda kayda sabitlenir; sonradan değişen ücretler geçmiş kayıtları etkilemez
(yönetici kayıt bazında değiştirebilir).

| Kalem | Hesap |
|---|---|
| Hizmet bedeli | Σ faturalanabilir saat × ücret |
| KDV matrahı | hizmet bedeli + müşteriye yansıtılan masraflar |
| KDV | matrah × KDV oranı (Ayarlar, varsayılan %20) |
| Stopaj | hizmet bedeli × stopaj oranı — yalnızca "Stopaj keser" işaretli müşterilerde |
| Fatura toplamı | matrah + KDV |
| Net tahsilat | fatura toplamı − stopaj |
| İndirilecek KDV | masrafların kendi KDV tutarları |

Rapor ekranından **Excel indir** (Özet, Kullanıcı Eforu, Aktiviteler, Masraflar sayfaları) veya
**Yazdır / PDF** (tarayıcının "PDF olarak kaydet" seçeneği) ile dışa aktarılır.
