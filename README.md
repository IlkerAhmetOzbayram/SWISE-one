# SWISE One

SWISE Teknoloji ve Danışmanlık'ın şirket içi iş uygulaması (küçük ERP).

Mevcut modüller: aktivite girişi ve efor takibi, masraf takibi, müşteri/proje yönetimi, muhasebe raporu,
işlem kaydı, yedekleme. Planlanan modüller ve kararlar: [docs/YOL-HARITASI.md](docs/YOL-HARITASI.md).

## Çalıştırma

Gereksinim: Node.js 24 veya üzeri (yerleşik SQLite kullanılır).

```bash
npm install
npm start
```

Tarayıcıda http://localhost:3000 adresini açın. İlk açılışta şirket adı ve yönetici hesabı oluşturulur.

```bash
npm test
```

Testler bellekte geçici bir veritabanıyla çalışır; gerçek veriye dokunmaz.

### Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `3000` | Sunucu portu |
| `DB_PATH` | `data.db` | Veritabanı dosyası |
| `BACKUP_DIR` | `backups/` | Günlük yedeklerin klasörü |
| `BACKUP_KEEP` | `14` | Saklanacak günlük yedek sayısı |
| `NODE_ENV` | — | Bulutta `production`: çerez yalnızca HTTPS'te gönderilir, HSTS açılır |
| `TRUST_PROXY` | — | Uygulama bir ters vekil (nginx, yük dengeleyici) arkasındaysa `1` |

## Veri ve yedekler

- Veriler `data.db` dosyasındadır; GitHub'a gönderilmez.
- Uygulama her gün `backups/swise-YYYY-MM-DD.db` adıyla otomatik yedek alır, son 14 günü saklar.
- Yönetici **Ayarlar → Yedekler** ekranından anlık bir yedeği indirebilir.
- Şema değişiklikleri `src/db/migrations/` altındaki geçişlerle uygulanır; açılışta bekleyen geçişler
  otomatik çalışır, hata olursa geri alınır.

## İşlem kaydı

Her ekleme, güncelleme, silme, giriş ve hatalı giriş denemesi kayda geçer. Güncellemelerde yalnızca değişen
alanlar eski → yeni değerleriyle saklanır. Yönetici **İşlem Kaydı** ekranından inceleyebilir.

## Güvenlik

- Parolalar scrypt ile özetlenir; oturum çerezi HttpOnly ve SameSite.
- Aynı kullanıcı adı için 15 dakikada 5 hatalı denemeden sonra giriş geçici olarak kilitlenir.
- Başka sitelerden gelen değişiklik istekleri reddedilir; güvenlik başlıkları (CSP, X-Frame-Options vb.) gönderilir.
- Parola değişince/sıfırlanınca kullanıcının diğer oturumları kapatılır.

## Kod yapısı

```
server.js                 Sunucuyu başlatır, günlük yedeği planlar
src/
  app.js                  Express uygulaması, modüllerin bağlanması
  config.js               Ortam değişkenleri
  db/                     Veritabanı bağlantısı ve geçişler (migrations)
  lib/                    Ortak: oturum, doğrulama, işlem kaydı, yedek, güvenlik
  modules/<modül>/        Her modülün API uç noktaları ve iş mantığı
public/
  js/core.js              Arayüz ortak yardımcıları
  js/pages/<sayfa>.js     Her ekran ayrı dosyada
  js/components/          Ortak arayüz bileşenleri
test/                     Otomatik testler (node:test)
docs/                     Yol haritası ve kararlar
```

## Roller

- **Yönetici**: müşteri/proje/kullanıcı tanımlar, tüm kayıtları görür ve düzenler, muhasebe raporunu alır,
  işlem kaydını ve yedekleri görür, ayarları değiştirir.
- **Çalışan**: yalnızca kendi aktivite ve masraflarını girer/düzenler; ücret bilgilerini görmez.
  (Ayrıntılı roller ve yetkiler Faz 3'te gelecek.)

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
