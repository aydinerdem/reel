# Reel — Kişisel Drive Medya Kütüphanesi

Google Drive'daki video / fotoğraf / müziklerini kendi statik sitende (GitHub Pages)
Infuse/Jellyfin tarzı bir arayüzle izlemeni sağlar. Sunucu yok — her şey tarayıcıda
çalışır, AirPlay için Safari'nin yerleşik `<video>` desteği kullanılır.

## Nasıl çalışıyor (özet)

- **Giriş:** Google'ın tarayıcı-içi OAuth akışıyla (Google Identity Services) sen ve
  Gözde kendi Google hesabınızla giriş yapıyorsunuz. Sunucuda hiçbir şifre/anahtar
  tutulmuyor.
- **Erişim kontrolü:** Ayrı bir kullanıcı sistemi yok — kimin ne göreceğini Google
  Drive'ın kendi paylaşım izinleri belirliyor. Gözde'nin görmesini istediğin
  klasör/dosyaları onun Google hesabına paylaşman yeterli.
- **Akış (streaming):** `sw.js` adlı bir Service Worker, oynatıcının istediği
  `stream/{dosyaId}` isteklerini arka planda Drive API'ye Range header'ı ve OAuth
  token'ıyla yönlendirip parça parça yanıt döndürüyor. Bu sayede video baştan
  tamamen inmeden oynatma ve ileri/geri sarma çalışıyor.
- **AirPlay:** Ekstra bir şey yapmana gerek yok — Safari (Mac/iPhone/iPad) `<video>`
  elemanında otomatik AirPlay ikonu gösteriyor, Apple TV'ni oradan seçebiliyorsun.

## Kurulum — Google Cloud tarafı (tek seferlik, ~5 dakika)

1. https://console.cloud.google.com adresine git, yeni bir proje oluştur (ör. "Reel").
2. Sol menü → **APIs & Services → Library** → "Google Drive API" ara → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (kişisel Gmail kullanıyorsan bu zorunlu).
   - Uygulama adı: "Reel" gibi bir şey, kendi mailini destek maili olarak yaz.
   - Scopes adımında bir şey eklemene gerek yok, boş geç.
   - **Test users** adımına kendi Gmail adresini ve Gözde'nin Gmail adresini ekle.
     (Uygulama "yayınlanmadığı" sürece sadece buraya eklediğin hesaplar giriş
     yapabilir — senin durumun için bu zaten yeterli ve daha güvenli.)
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins** kısmına, aşağıda oluşturacağın GitHub Pages
     adresini ekle, ör: `https://kullaniciadin.github.io`
   - Oluşturduktan sonra çıkan **Client ID**'yi kopyala.
5. `config.js` dosyasını aç, `CLIENT_ID` alanına bu değeri yapıştır.

İsteğe bağlı: Tüm Drive'ını taramak yerine belirli bir klasörle sınırlamak istersen
(ör. sadece "Aile Videoları" klasörü), o klasörü Drive'da aç, linkteki
`/folders/XXXXXXXX` kısmındaki ID'yi `config.js` içindeki `ROOT_FOLDER_ID` alanına yaz.

## Kurulum — GitHub Pages tarafı

1. Bu klasördeki dosyaları (`index.html`, `style.css`, `app.js`, `sw.js`, `config.js`)
   yeni bir GitHub reposuna yükle (ör. `reel`).
2. Repo → **Settings → Pages** → Source: `main` branch, `/root` klasörü → Save.
3. Birkaç dakika sonra `https://kullaniciadin.github.io/reel/` adresi yayında olur.
4. Bu tam adresi Google Cloud'daki **Authorized JavaScript origins** kısmına da
   eklemeyi unutma — sadece `https://kullaniciadin.github.io` yetmeyebilir, repo alt
   yolu farklı origin sayılmaz aslında (origin = protokol+domain+port, path önemli
   değil), yani `https://kullaniciadin.github.io` girmen yeterli.
5. Telefon/Apple TV'den kullanmak için Safari'de bu adresi aç, "Ana Ekrana Ekle"
   yaparsan uygulama gibi ikon da olur.

## Gözde için

Ayrı bir hesap tanımlamana gerek yok. Aynı siteye o da girip kendi Google hesabıyla
oturum açacak; Google consent screen'de test user olarak eklediğin ve Drive'da
paylaştığın klasörler neyse onları görecek.

## Bilinen sınırlar / geliştirilebilecek noktalar

- **Küçük resimler (thumbnail):** Drive'ın verdiği `thumbnailLink` doğrudan
  kullanılıyor; bazı çok yeni yüklenen dosyalarda birkaç dakika thumbnail
  oluşmayabilir, o dosyalar boş kutu olarak görünür.
- **Oturum süresi:** Google erişim token'ı ~1 saat geçerli. Süre dolduğunda
  otomatik sessiz yenileme deniyor; bazen Google tekrar bir onay penceresi
  isteyebilir (test-user modunda normal).
- **Kod/format uyumluluğu:** Gerçek transcoding yapılmıyor (Jellyfin'in aksine).
  Safari/tvOS'un doğrudan oynatamadığı bir codec varsa (ör. bazı eski .avi/.wmv
  dosyaları) o dosya oynamayabilir — senin X pipeline'ında zaten mp4/h264 ağırlıklı
  organize ettiğin için pratikte sorun çıkması beklenmiyor.
- **İleride:** İstersen ileride bunu zaten planladığın Hetzner VPS'e taşıyıp gerçek
  transcoding (ffmpeg) eklemek, "izleme geçmişi / kaldığın yer" gibi Jellyfin
  özellikleri kazandırmak mümkün — bu sürüm bilinçli olarak sunucusuz ve basit
  tutuldu.
