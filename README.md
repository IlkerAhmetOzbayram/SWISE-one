# SWISE One

SWISE Teknoloji ve Danışmanlık'ın şirket içi iş uygulaması (küçük ERP).

Mevcut modüller: ana sayfa (gösterge), efor (günlük/haftalık/aylık), aktivite ve masraf girişi, müşteri yapısı,
muhasebe raporu, müşteri efor raporu, aylık bütçe (plan/gerçekleşen/tahmin), tatil listesi, işlem kaydı, yedekleme.
Planlanan modüller ve kararlar: [docs/YOL-HARITASI.md](docs/YOL-HARITASI.md).

## Çalıştırma

Gereksinim: Node.js 24 veya üzeri (yerleşik SQLite kullanılır).

```bash
npm install
npm start
```

Tarayıcıda http://localhost:3000 adresini açın. İlk açılışta şirket adı ve yönetici hesabı oluşturulur.

Geliştirme sırasında girişsiz çalışmak için:

```bash
npm run gelistirme
```

Bu modda yalnızca bu bilgisayardan (localhost) gelen istekler giriş istenmeden ilk yönetici olarak kabul edilir;
hiç yönetici yoksa "Yerel Yönetici" oluşturulur. Başka cihazlardan erişimde giriş yine zorunludur ve
`NODE_ENV=production` iken bu mod hiçbir şekilde açılmaz.

```bash
npm test
```

Testler bellekte geçici bir veritabanıyla çalışır; gerçek veriye dokunmaz.

Parolası unutulan bir hesabı sunucuda sıfırlamak için (yeni parola gizli olarak sorulur):

```bash
npm run parola-sifirla -- <kullanıcı adı>
```

### Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `3000` | Sunucu portu |
| `DB_PATH` | `data.db` | Veritabanı dosyası |
| `BACKUP_DIR` | `backups/` | Günlük yedeklerin klasörü |
| `BACKUP_KEEP` | `14` | Saklanacak günlük yedek sayısı |
| `NODE_ENV` | — | Bulutta `production`: çerez yalnızca HTTPS'te gönderilir, HSTS açılır |
| `TRUST_PROXY` | — | Uygulama bir ters vekil (nginx, yük dengeleyici) arkasındaysa `1` |
| `NO_LOGIN` | — | `1`: girişsiz geliştirme modu (`npm run gelistirme` ile aynı); canlıda yok sayılır |

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

## Müşteri yapısı

```
Müşteri (grup)    günlük ücret, varsayılan para birimi, ödeme vadesi
 └─ Şirket        fatura bilgileri (unvan, VKN, vergi dairesi, adres), stopaj, KDV muafiyeti;
    │             ücret/para birimi/vade boşsa müşteriden alınır
    └─ Proje      isteğe bağlı; kendi günlük ücreti olabilir
İletişim kişisi   müşteri geneline veya bir şirkete bağlı; "teklif alır" / "fatura alır"
```

Yeni müşteri ilk şirketiyle birlikte oluşturulur. 1 gün = 8 saat.
Aktivite ve masraflar müşteri/şirkete girilir; proje seçmek isteğe bağlıdır. Tek şirketli müşteride şirket
seçimi gösterilmez. Kaydı giren kullanıcı otomatik yazılır; yalnızca yönetici değiştirebilir.
VKN / TCKN en fazla 11 karakterdir (rakam ve harf).

## Bütçe ve iş günleri

- İş günü: Pazartesi–Cuma; Ayarlar → Tatiller listesindeki günler düşülür (yarım gün = 0,5).
- Aylık plan müşteri bazında adam-gün olarak girilir (isteğe bağlı şirket/proje kırılımı);
  plan tutarı = adam-gün × geçerli günlük ücret.
- Tahmin = faturalanabilir gerçekleşen ÷ geçen iş günü × ayın iş günü.

## Ücret ve rapor hesapları

Günlük ücret önceliği: proje → şirket → müşteri. Para birimi: şirket → müşteri.
Ücret ve para birimi aktivite girildiği anda kayda sabitlenir; sonradan değişen ücretler geçmiş kayıtları
etkilemez (yönetici kayıt bazında değiştirebilir).

| Kalem | Hesap |
|---|---|
| Hizmet bedeli | Σ faturalanabilir saat × günlük ücret / 8 |
| KDV matrahı | hizmet bedeli + müşteriye yansıtılan masraflar |
| KDV | matrah × KDV oranı (Ayarlar, varsayılan %20); "KDV uygulanmaz" şirketlerde 0 |
| Stopaj | hizmet bedeli × stopaj oranı — yalnızca "Stopaj keser" işaretli şirketlerde |
| Fatura toplamı | matrah + KDV |
| Net tahsilat | fatura toplamı − stopaj |
| İndirilecek KDV | masrafların kendi KDV tutarları |

TL, EUR ve USD tutarları birbirine eklenmez; rapor her para birimini ayrı toplar (kur çevirisi Faz 5'te).
Rapor ekranından **Excel indir** (Özet, Kullanıcı Eforu, Aktiviteler, Masraflar sayfaları) veya
**Yazdır / PDF** (tarayıcının "PDF olarak kaydet" seçeneği) ile dışa aktarılır.
