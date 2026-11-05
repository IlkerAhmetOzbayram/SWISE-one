#!/usr/bin/env bash
# SWISE One: boş bir Ubuntu 24.04 sunucuya kurulum.
# Kullanım (sunucuda, root olarak):
#   curl -fsSL https://raw.githubusercontent.com/IlkerAhmetOzbayram/SWISE-one/main/deploy/kurulum.sh -o kurulum.sh
#   sudo bash kurulum.sh one.swise.com.tr bt@swise.com.tr
# Depo gizliyse betik dosyası elle kopyalanır (docs/KURULUM.md).
#
# Yaptıkları: sistem güncellemesi, güvenlik duvarı, otomatik güvenlik yamaları, Node.js 24, nginx,
# Let's Encrypt HTTPS, "swise" kullanıcısı, uygulama (/opt/swise-one), veri (/var/lib/swise-one),
# sistem servisi, gece sunucu dışı yedek zamanlayıcısı ve "swise-one" yönetim komutu.
# Tekrar çalıştırılabilir: var olan veri ve ayarlara dokunmaz.
set -euo pipefail

DOMAIN=${1:-}
EMAIL=${2:-}
REPO=${REPO:-git@github.com:IlkerAhmetOzbayram/SWISE-one.git}
APP_DIR=/opt/swise-one
DATA_DIR=/var/lib/swise-one
ENV_FILE=/etc/swise-one.env

[[ $EUID -eq 0 ]] || { echo "Root olarak çalıştırın: sudo bash kurulum.sh <alan adı> <e-posta>"; exit 1; }
[[ -n $DOMAIN && -n $EMAIL ]] || { echo "Kullanım: sudo bash kurulum.sh <alan adı> <e-posta>   (örn. one.swise.com.tr bt@swise.com.tr)"; exit 1; }
step() { echo; echo "==> $*"; }

step "Sistem paketleri"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq git curl ca-certificates nginx certbot python3-certbot-nginx ufw rclone unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades
timedatectl set-timezone Europe/Istanbul

step "Node.js 24"
if ! node --version 2>/dev/null | grep -q '^v24\.'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -yq nodejs
fi
node --version

step "Güvenlik duvarı (yalnızca SSH, HTTP, HTTPS)"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

step "Uygulama kullanıcısı ve klasörler"
id swise >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/swise --shell /usr/sbin/nologin swise
install -d -o swise -g swise -m 750 "$DATA_DIR" "$DATA_DIR/backups" "$DATA_DIR/uploads"
install -d -o swise -g swise -m 755 "$APP_DIR"

step "GitHub erişimi (salt okunur dağıtım anahtarı)"
if [[ ! -f /home/swise/.ssh/id_ed25519 ]]; then
  sudo -u swise install -d -m 700 /home/swise/.ssh
  sudo -u swise ssh-keygen -q -t ed25519 -N '' -C "swise-one@$DOMAIN" -f /home/swise/.ssh/id_ed25519
  sudo -u swise sh -c 'ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null'
fi
if [[ ! -d $APP_DIR/.git ]]; then
  until sudo -u swise git ls-remote "$REPO" >/dev/null 2>&1; do
    echo
    echo "Aşağıdaki anahtarı GitHub'da depo → Settings → Deploy keys → Add deploy key bölümüne ekleyin"
    echo "(Başlık: sunucu, \"Allow write access\" İŞARETLEMEYİN):"
    echo
    cat /home/swise/.ssh/id_ed25519.pub
    echo
    read -r -p "Ekledikten sonra Enter'a basın... "
  done
  sudo -u swise git clone --quiet "$REPO" "$APP_DIR"
fi
(cd "$APP_DIR" && sudo -u swise npm ci --omit=dev --no-audit --no-fund --silent)

step "Ayarlar ($ENV_FILE)"
if [[ ! -f $ENV_FILE ]]; then
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
TRUST_PROXY=1
PUBLIC_URL=https://$DOMAIN
DB_PATH=$DATA_DIR/data.db
BACKUP_DIR=$DATA_DIR/backups
UPLOAD_DIR=$DATA_DIR/uploads
BACKUP_KEEP=30
EOF
  chown root:swise "$ENV_FILE"
  chmod 640 "$ENV_FILE"
fi

step "Servis ve yönetim komutu"
install -m 755 "$APP_DIR/deploy/swise-one" /usr/local/bin/swise-one
install -m 644 "$APP_DIR/deploy/swise-one.service" /etc/systemd/system/swise-one.service
install -m 644 "$APP_DIR/deploy/swise-one-yedek.service" /etc/systemd/system/swise-one-yedek.service
install -m 644 "$APP_DIR/deploy/swise-one-yedek.timer" /etc/systemd/system/swise-one-yedek.timer
systemctl daemon-reload
systemctl enable --now swise-one
systemctl enable --now swise-one-yedek.timer

step "nginx ve HTTPS sertifikası"
sed "s/ALAN_ADI/$DOMAIN/g" "$APP_DIR/deploy/nginx-swise-one.conf" > /etc/nginx/sites-available/swise-one
ln -sf /etc/nginx/sites-available/swise-one /etc/nginx/sites-enabled/swise-one
rm -f /etc/nginx/sites-enabled/default
sed -i 's/^\s*#\?\s*server_tokens .*/\tserver_tokens off;/' /etc/nginx/nginx.conf
nginx -t
systemctl reload nginx
if [[ ! -d /etc/letsencrypt/live/$DOMAIN ]]; then
  certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --no-eff-email --redirect -n
fi

step "Kontrol"
sleep 2
if curl -fsS "https://$DOMAIN/api/health" >/dev/null; then
  echo "SWISE One çalışıyor: https://$DOMAIN"
else
  echo "UYARI: https://$DOMAIN yanıt vermiyor. DNS kaydını ve 'sudo swise-one log' çıktısını kontrol edin."
fi
cat <<EOF

Sıradaki adımlar:
  1. Yönetici hesabı:  sudo swise-one yonetici-olustur <kullanıcı adı> "Ad Soyad"
  2. (Varsa) yereldeki veriyi aktarın: docs/KURULUM.md → Veri aktarımı
  3. Sunucu dışı yedeği ayarlayın:     docs/KURULUM.md → Sunucu dışı yedek
  4. Durum:                            sudo swise-one durum
EOF
