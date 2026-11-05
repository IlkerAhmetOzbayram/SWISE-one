# SWISE One – Bulut sunucu kurulumu (Faz 6.1)

Bu rehber uygulamayı Türkiye'deki bir sanal sunucuda, kendi alan adınız ve HTTPS ile yayına almak içindir.
Komutların çoğunu kurulum betiği çalıştırır; sizin yapmanız gerekenler **kalın** işaretli.

## 1. Sunucu seçimi

İhtiyaç küçük: 10–20 kişilik ekip için **2 vCPU, 4 GB bellek, 40 GB SSD, Ubuntu 24.04** yeterli.
Veritabanı SQLite olduğundan ayrı bir veritabanı sunucusu gerekmez.

| Ölçüt | Neden önemli |
|---|---|
| Veri merkezi Türkiye'de | Verinin yurt içinde kalması kararımız (KVKK açısından en sade yol) |
| Ubuntu 24.04 ve root/SSH erişimi | Kurulum betiği buna göre yazıldı (yönetilen "hosting" paketleri uygun değil) |
| Sabit IPv4 | Alan adı kaydı bu adrese yönlenir |
| Sanal sunucu anlık görüntüsü (snapshot) | Büyük değişikliklerden önce tüm sunucunun kopyası |
| S3 uyumlu nesne depolama (aynı ya da başka sağlayıcı) | Sunucu dışı şifreli yedek için |
| Türkçe destek, fatura (e-fatura) | Şirket gideri olarak |

Aday sağlayıcılar (fiyatlar kampanyaya ve kura göre sık değişir; Kasım 2026 itibarıyla aramalarda görülen **gösterge** değerlerdir, satın almadan önce sağlayıcının sayfasından doğrulayın):

| Sağlayıcı | 2 vCPU / 4 GB gösterge | Not |
|---|---|---|
| Turhost (VPS 4) | ~17 $/ay + KDV | 40 GB NVMe, İstanbul |
| GoDaddy TR | ~400 TL/ay | 100 GB NVMe |
| Natro | 4 GB fiyatı bulunamadı (2 vCPU / 6 GB ~574 TL/ay) | Yerli, yaygın |
| Radore | Teklif ile | KVKK uyumlu barındırmayı öne çıkarıyor, İstanbul veri merkezi |
| Turkcell Bulut / Türk Telekom | Teklif ile | Kurumsal; nesne depolama ve yedekleme hizmetleri var |
| AWS İstanbul Local Zone | Kullanıma göre | Mayıs 2026'da açıldı; EC2 ve S3 İstanbul'da |

Sunucu dışı yedek için Türkiye'de S3 uyumlu depolama: sunucu sağlayıcınızınki, Narbulut NOSS ya da AWS İstanbul S3.

**Öneri:** Fiyat/performans için Turhost veya Natro gibi yerli bir VPS + ayrı bir sağlayıcıda (örn. Narbulut) yedek depolama.
Yedeğin sunucuyla aynı firmada olmaması, firma kaynaklı bir sorunda da veriyi korur.

## 2. Satın alma ve DNS (**sizin yapmanız gerekenler**)

1. **Sunucuyu satın alın:** Ubuntu 24.04, 2 vCPU / 4 GB. Kurulumda SSH anahtarı eklenebiliyorsa ekleyin, yoksa root parolası verilir.
2. **Sunucunun IPv4 adresini** not edin.
3. **Alan adı kaydı:** swise.com.tr'nin DNS panelinde bir **A kaydı** ekleyin: `one` → sunucu IP adresi.
   Birkaç dakika–birkaç saat içinde yayılır. Kontrol (Windows'ta): `nslookup one.swise.com.tr`
4. **GitHub deposu gizliyse** sorun değil: kurulum betiği bir "deploy key" üretir ve eklemeniz için ekranda gösterir.

## 3. Kurulum

Windows'tan sunucuya bağlanın (PowerShell):

```
ssh root@<sunucu-ip>
```

Sunucuda (depo gizliyse betiği önce kendi bilgisayarınızdan kopyalayın: `scp deploy\kurulum.sh root@<sunucu-ip>:`):

```
sudo bash kurulum.sh one.swise.com.tr bt@swise.com.tr
```

Betik sırasıyla şunları yapar: sistem güncellemesi, otomatik güvenlik yamaları, saat dilimi (İstanbul), güvenlik duvarı
(yalnızca SSH/HTTP/HTTPS), Node.js 24, `swise` uygulama kullanıcısı, GitHub'dan kod (salt okunur anahtar),
`/etc/swise-one.env` ayarları, sistem servisi, nginx, Let's Encrypt HTTPS sertifikası (90 günde bir kendiliğinden yenilenir)
ve `swise-one` yönetim komutu. Tekrar çalıştırılabilir; var olan veriye dokunmaz.

Klasörler: kod `/opt/swise-one`, veritabanı `/var/lib/swise-one/data.db`, dosyalar `/var/lib/swise-one/uploads`,
günlük yedekler `/var/lib/swise-one/backups` (30 gün).

## 4. Yönetici hesabı ve veri

**Temiz başlangıç:**

```
sudo swise-one yonetici-olustur ilker "İlker Özbayram"
```

Güvenlik için canlıda ilk yönetici web sayfasından oluşturulamaz (adrese ilk ulaşan kişi yönetici olmasın diye); yalnızca bu komutla.

**Yereldeki veriyi aktarma** (müşteriler, aktiviteler, teklifler...):

1. Windows'ta, proje klasöründe tutarlı bir kopya alın ve sunucuya gönderin:
   ```
   node scripts/anlik-yedek.js aktarim.db
   scp aktarim.db root@<sunucu-ip>:/root/
   scp -r uploads root@<sunucu-ip>:/root/
   ```
2. Sunucuda:
   ```
   sudo swise-one geri-yukle /root/aktarim.db
   sudo cp -rn /root/uploads/. /var/lib/swise-one/uploads/ && sudo chown -R swise:swise /var/lib/swise-one/uploads
   sudo swise-one yonetici-olustur ilker "İlker Özbayram"
   ```
   Komut, geliştirmede oluşan "Yerel Yönetici" hesabını size dönüştürmeyi önerir; "E" derseniz o hesapla girilen kayıtlar size geçer.
3. Aktarımdan sonra `aktarim.db` dosyalarını hem bilgisayarınızdan hem sunucudan silin (`rm /root/aktarim.db`).

## 5. Ekibi davet etme

Personel → Yeni personel'de **parolayı boş bırakın**. Kartta tek kullanımlık **davet bağlantısı** çıkar (7 gün geçerli):
"Kopyala" ya da "Mail taslağı" ile gönderin. Kişi bağlantıdan kendi parolasını belirleyip girer.
Parolasını unutan için kartta "Giriş bağlantısı oluştur" (24 saat geçerli). Yönetici hesabının bağlantısını yalnızca bir Yönetici oluşturabilir.
Faz 6.2'de Microsoft hesabıyla giriş gelince ekip için parola gerekmeyecek.

## 6. Sunucu dışı yedek (şifreli)

Uygulama her gün yedek alır, ama sunucu tamamen kaybolursa yedekler de gider. Bu yüzden her gece 03:30'da
yedekler sunucu dışına **şifrelenerek** kopyalanır (rclone). Bir kez ayarlanır:

1. Yedek depolamada bir kova (bucket) açın; erişim anahtarı (access key / secret) alın.
2. Sunucuda `sudo rclone config --config /etc/swise-one-rclone.conf`:
   - `n` → ad: `depo` → tür: `s3` → sağlayıcı: `Other` (veya listede varsa sağlayıcınız) → anahtarlar ve uç nokta (endpoint) adresi
   - `n` → ad: `swise-yedek` → tür: `crypt` → remote: `depo:kova-adi/swise-one` → dosya adlarını şifrele: `standard`
     → **güçlü bir parola** belirleyin ve **parolayı şirket kasasında/parola yöneticisinde saklayın** (yoksa yedek açılamaz)
3. `sudo chmod 600 /etc/swise-one-rclone.conf` ve deneme: `sudo swise-one yedek-disari`

## 7. Geri yükleme provası (kurulumdan sonra bir kez)

```
sudo swise-one yedek                                 # anlık yedek
sudo swise-one geri-yukle /var/lib/swise-one/backups/elle/<dosya>.db
```

Sunucu dışı yedekten: `sudo rclone --config /etc/swise-one-rclone.conf copy swise-yedek:swise-YYYY-MM-DD.db /root/`
ardından `sudo swise-one geri-yukle /root/swise-YYYY-MM-DD.db`.

## 8. Günlük kullanım

| Komut | Ne yapar |
|---|---|
| `sudo swise-one durum` | Servis, sürüm, son yedekler, disk |
| `sudo swise-one guncelle` | main dalındaki yeni sürümü alır; öncesinde yedek alır, açılmazsa önceki sürüme ve yedeğe döner |
| `sudo swise-one log` | Uygulama kayıtları |
| `sudo swise-one parola-sifirla <kullanıcı>` | Parola sıfırlama (son çare) |

Güvenlik notları: SSH'ta parola yerine anahtarla girişe geçin ve root parolasını kapatın (rehberde birlikte yaparız);
`/etc/swise-one.env` ve rclone ayarı yalnızca yetkililer tarafından okunabilir; sunucu güvenlik yamalarını kendisi kurar.
