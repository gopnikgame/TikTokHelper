#!/bin/bash

domains=(monitoring.tik-talk.ru)
email="info@vpnline.online" # Email для уведомлений Let's Encrypt
staging=0 # Установите 1 для тестирования работы скрипта (не создает реальные сертификаты)

# Создаем необходимую структуру директорий
mkdir -p ./certbot/conf
mkdir -p ./certbot/www

# Создаем фейковые сертификаты для первого запуска nginx
if [ ! -e "./certbot/conf/live/$domains/fullchain.pem" ]; then
  echo "### Создаем временные самоподписанные сертификаты..."
  mkdir -p "./certbot/conf/live/$domains"
  
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout "./certbot/conf/live/$domains/privkey.pem" \
    -out "./certbot/conf/live/$domains/fullchain.pem" \
    -subj "/CN=$domains"
  
  echo "### Временные сертификаты созданы"
fi

# Запускаем nginx для проверки домена
echo "### Запускаем nginx для проверки домена..."
docker-compose up -d nginx
echo "### Ждем 10 секунд, чтобы nginx запустился..."
sleep 10

# Останавливаем nginx, если он был запущен для других контейнеров
echo "### Останавливаем nginx..."
docker-compose stop nginx

# Запускаем certbot для получения реальных сертификатов
echo "### Запрашиваем сертификаты Let's Encrypt..."
docker-compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  --email $email \
  --agree-tos \
  --no-eff-email \
  -d $domains \
  $([ "$staging" = "1" ] && echo "--staging")

# Перезапускаем все контейнеры, чтобы применить новые сертификаты
echo "### Перезапускаем все контейнеры..."
docker-compose down
docker-compose up -d

echo "### Готово! Проверьте работу сайта по адресу https://$domains"
echo "### Сертификаты расположены в ./certbot/conf/live/$domains/"
echo "### Следующее автоматическое обновление произойдет через ~90 дней"

# Выводим информацию для проверки сертификатов
echo "### Проверка сертификата:"
docker-compose exec nginx openssl x509 -in /etc/letsencrypt/live/$domains/fullchain.pem -text -noout | grep "Subject\|Issuer\|Not Before\|Not After"
