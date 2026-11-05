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

Tarayıcıda http://localhost:3000 adresini açın. İlk açılışta şirket adı ve yönetici hesabı oluşturulur
(canlıda güvenlik için web'den değil, `npm run yonetici-olustur` / `sudo swise-one yonetici-olustur` komutuyla).

Bulut sunucuya kurulum, güncelleme, yedek ve geri yükleme: [docs/KURULUM.md](docs/KURULUM.md).

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

Yönetici hesabı oluşturmak ya da var olan kullanıcıyı Yönetici yapmak için (geliştirmede oluşan "Yerel Yönetici"
hesabını kayıtlarıyla devralmayı önerir):

```bash
npm run yonetici-olustur -- <kullanıcı adı> "Ad Soyad"
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
| `UPLOAD_DIR` | `uploads/` | Teklif PDF'leri ve imzalı dosyalar |
| `NO_LOGIN` | — | `1`: girişsiz geliştirme modu (`npm run gelistirme` ile aynı); canlıda yok sayılır |
| `HOST` | — | Dinlenecek adres; bulutta nginx arkasında `127.0.0.1` |
| `PUBLIC_URL` | — | Dış adres (örn. `https://one.swise.com.tr`); davet bağlantılarında kullanılır, canlıda zorunlu |
| `RATES_AUTO` | — | `0`: TCMB kurlarının otomatik çekilmesini kapatır |

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
- Yeni personel parolasız oluşturulabilir: tek kullanımlık davet bağlantısı (7 gün) ile kendi parolasını belirler.
  Parola sıfırlama bağlantısı 24 saat geçerlidir; yenisi oluşturulunca eskisi geçersiz olur. Bağlantı anahtarı
  veritabanında yalnızca SHA-256 özetiyle tutulur. Yönetici hesabının parolasına/bağlantısına yalnızca bir Yönetici dokunabilir.
- Canlıda (`NODE_ENV=production`) ilk yönetici web'den oluşturulamaz; adrese ilk ulaşan kişi yönetici olamaz.
- `/api/health` giriş gerektirmeyen sağlık kontrolüdür (bilgi içermez).

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
scripts/                  Komut satırı: yönetici oluşturma, parola sıfırlama, anlık yedek
deploy/                   Bulut kurulum betiği, servis/nginx ayarları, swise-one yönetim komutu
test/                     Otomatik testler (node:test)
docs/                     Yol haritası, kararlar ve kurulum rehberi
```

## Roller ve yetkiler

Yetkiler rol bazındadır (Personel → Roller ve yetkiler). Her modülde görme / ekleme-düzenleme / onaylama /
kapatma yetkileri ayrı ayrı verilir; kayıt kapsamı *kendi*, *sorumlu olduğu müşteriler* veya *tümü* olabilir.

| Rol | Özet |
|---|---|
| Yönetici | Tüm yetkiler (kilitli, değiştirilemez) |
| Muhasebe | Tüm efor/masrafı görür, masraf onaylar, raporlar, bütçe, maaş, ay kapanışı |
| Proje Yöneticisi | Sorumlu olduğu müşterilerin eforu ve efor raporu; ücret görmez |
| Çalışan | Yalnızca kendi aktivite ve masrafları |

Özel rol, mevcut bir rolden kopyalanarak oluşturulur. En az bir aktif Yönetici her zaman kalır.

## Onaylar ve kilitler

- **Masraf:** onay yetkisi olmayanın girdiği masraf "onay bekliyor" başlar; onaylanmamış masraf muhasebe
  raporunda müşteriye yansıtılmaz. Onaylanan masrafı yalnızca onaylayan değiştirebilir.
- **Haftalık efor:** çalışan haftasını onaya gönderir; onaylanan hafta kilitlenir ("Yeniden aç" ile açılır).
- **Ay kapanışı:** kapalı ayın aktivite ve masrafları kimse tarafından değiştirilemez; yalnızca Yönetici yeniden açar.

## Teklifler

- Teklif Türkçe veya İngilizce hazırlanır; müşteri › şirket, ilgili kişi ("teklif alır" işaretliler önerilir),
  kalemler (danışmanlık adam-gün, sabit ücret, lisans/masraf; iskonto), ödeme planı, kapsam, varsayımlar ve şartlar.
- Numara otomatiktir: `ÖNEK-YIL-SIRA` (örn. SWISE-2026-0001); önek ve şablon metinleri Ayarlar → Teklif şablonu.
- Akış: Taslak → Onay bekliyor → Onaylandı (PDF dondurulur, SHA-256 kaydedilir) → İmzalandı (imzalı dosya yüklenir)
  → Gönderildi → Kabul / Red. Gönderilmiş teklifin geçerlilik süresi geçerse "süresi doldu" görünür.
- Revizyon açıldığında teklif yeniden taslak olur; önceki sürümün PDF'i ve imzalı dosyası arşivde değişmeden kalır.
- Mail gönderimi elle yapılır: "Mail taslağı" alıcıları ve metni doldurulmuş bir taslak açar; dosya elle eklenir.
- Dosyalar `uploads/` klasöründe tutulur (`UPLOAD_DIR`) ve günlük yedekte `backups/uploads/` altına kopyalanır.

## Muhasebe

- Kurlar TCMB'den (today.xml, gerekirse son 7 günün arşivi) açılışta ve 6 saatte bir çekilir; Tanımlar → Kurlar'dan elle de girilebilir.
  Bir tarih için o güne ya da öncesindeki en yakın kur kullanılır.
- Giden fatura aktivitelerden oluşturulur: proje ve ücrete göre "gün" kalemleri (8 saat = 1 gün) ve onaylı yansıtılabilir masraflar.
  Faturalanan kayıtlar faturaya bağlanır; taslak silinir ya da fatura iptal edilirse yeniden faturalanabilir.
- Fatura kesilirken resmi numara elle girilir (uygulama e-fatura kesmez). Stopaj yalnızca hizmet kalemlerine uygulanır.
- Tahsilat/ödeme faturaya bağlanır; hesap ile fatura dövizi farklıysa fatura dövizindeki karşılığı da girilir. Kalan tutar aşılamaz.
- Personel cari: bordro tutarları muhasebeciden girilir; net maaş personele, SGK ve vergiler devlete borç yazılır.
  Maaş ödemesi, avans ve masraf iadesi bu bakiyeden düşer. Maaş bilgileri yalnızca maaş yetkisi olanlara görünür.
- Gelir–gider tablosu tahakkuk esaslıdır (TL, fatura kuru); bütçe kategori bazında aylık plan ve efor planından gelir tahmini içerir.
- Muhasebeci için aylık Excel: faturalar, kasa/banka hareketleri ve bordro sayfaları.

## Personel ve KVKK

Personel kartı: genel bilgiler, hesap/rol, hassas bilgiler (IBAN, acil durum kişisi) ve maaş geçmişi.
Hassas bilgilerin başkası tarafından görüntülenmesi işlem kaydına yazılır; değerlerin kendisi kayda yazılmaz.
Ayrılan ve pasif personelin iletişim ve hassas bilgileri anonimleştirilebilir (maaş geçmişi yasal saklama için kalır).
Parolalar en az 8 karakterdir.

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
