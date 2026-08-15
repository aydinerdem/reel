// === Kendi ayarların ===
// 1) Google Cloud Console'dan aldığın OAuth 2.0 Client ID'yi buraya yapıştır.
//    (README.md içindeki adımları takip et)
window.MEDIAHUB_CONFIG = {
  CLIENT_ID: "145719638435-gt0r8loenqla18vimobgt10lba15mevh.apps.googleusercontent.com",

  // Opsiyonel: Drive'da her şeyi taramak yerine belirli bir klasörle sınırlamak
  // istersen o klasörün ID'sini buraya yaz (klasör linkindeki /folders/XXXX kısmı).
  // Boş bırakırsan tüm Drive'da video/fotoğraf/müzik dosyalarını tarar.
  ROOT_FOLDER_ID: "",

  // Sadece istenen mimeType'lar taranır, sonuçlar bu üç sekmeye göre gruplanır.
  SCOPES: "https://www.googleapis.com/auth/drive.readonly",
};
